# Beaver Sync Bootstrap And Propagation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Beaver Sync's inferred file-directory bootstrap and timestamp cursors with a durable cloud protocol that reliably seeds, joins, and propagates encrypted workspace data.

**Architecture:** Beaver Sync will use SQLite as the authoritative hot update journal and R2 for encrypted snapshots/assets. The API will expose explicit workspace sync state, serialized initialization, idempotent update identities, and continuation-based pulls. Beaver Notes will use those contracts only for `remote` transport; the folder transport remains unchanged.

**Tech Stack:** Node.js, Fastify, better-sqlite3, SQLite migrations, R2-compatible object storage, Vue/Pinia, Tauri Rust Yjs bridge, Yjs, Vitest.

## Global Constraints

- Do not modify the folder transport as part of this phase.
- Phase-one implementation and validation use `remote` transport only.
- SQLite is the authoritative hot update journal.
- R2 stores encrypted document snapshots and asset blobs, not individual Yjs updates.
- Update identity is `workspaceId + noteId + deviceId + sequence`.
- Never advance a cursor before durable local application or successful server acknowledgement.
- Never delete journal data before verified snapshot replacement.
- Never log payloads, passphrases, or encryption keys.
- Never report sync success for a skipped lock, offline, missing-key, or authorization operation.
- Preserve and do not stage unrelated existing changes in `src/utils/sync/remote-yjs.js` and `src/utils/sync/transports/cloud.js`.

---

## Task 1: Add Durable Sync State And Idempotent Journal Identity

**Files:**
- Create: `/Users/danielerolli/Documents/GitHub/Beaver-Sync/src/db/migrations/002-sync-protocol.sql`
- Modify: `/Users/danielerolli/Documents/GitHub/Beaver-Sync/src/db/schema.sql`
- Modify: `/Users/danielerolli/Documents/GitHub/Beaver-Sync/src/persistence/yjs.js`
- Test: `/Users/danielerolli/Documents/GitHub/Beaver-Sync/test/yjs-persistence.test.js`

**Interfaces:**
- Produces `sync_workspace_state`, `sync_document_state`, and a unique update identity constraint.
- Produces `storeUpdatesBatch(workspaceId, noteId, updates)` returning `{ accepted, duplicate, checkpoint }`.
- Produces `getWorkspaceSyncState(workspaceId)` and `getDocumentSyncState(workspaceId, noteId)`.
- Produces `loadUpdatesAfter(workspaceId, noteId, checkpoint, limit)` returning `{ updates, nextCheckpoint, hasMore }`.

- [ ] **Step 1: Write failing persistence tests**

```js
it('accepts an update once and reports a replay as duplicate', async () => {
  const first = await persistence.storeUpdatesBatch('ws-1', 'note-1', [
    { deviceId: 'device-a', sequence: 7, data: Buffer.from('x'), ts: 10 },
  ]);
  const second = await persistence.storeUpdatesBatch('ws-1', 'note-1', [
    { deviceId: 'device-a', sequence: 7, data: Buffer.from('x'), ts: 10 },
  ]);

  expect(first.accepted).toBe(1);
  expect(second.duplicate).toBe(1);
  expect(await persistence.getUpdateCount('ws-1', 'note-1')).toBe(1);
});

it('returns continuation metadata when a pull is truncated', async () => {
  await seedUpdates('ws-1', 'note-1', 3);
  const page = await persistence.loadUpdatesAfter('ws-1', 'note-1', null, 2);

  expect(page.updates).toHaveLength(2);
  expect(page.hasMore).toBe(true);
  expect(page.nextCheckpoint).toEqual({ ts: expect.any(Number), sequence: expect.any(Number) });
});
```

- [ ] **Step 2: Run the persistence tests and verify they fail**

Run: `npm test -- --runInBand test/yjs-persistence.test.js` in `/Users/danielerolli/Documents/GitHub/Beaver-Sync`.
Expected: FAIL because the migration and new persistence functions do not exist.

- [ ] **Step 3: Add the schema and migration**

Create tables with these constraints:

```sql
CREATE TABLE IF NOT EXISTS sync_workspace_state (
  workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK(status IN ('empty', 'initializing', 'initialized', 'recovering')),
  generation INTEGER NOT NULL DEFAULT 0,
  initialization_token TEXT,
  initialization_expires_at TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sync_document_state (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  note_id TEXT NOT NULL,
  snapshot_generation INTEGER NOT NULL DEFAULT 0,
  snapshot_key TEXT,
  checkpoint_ts INTEGER NOT NULL DEFAULT 0,
  checkpoint_sequence INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, note_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_yjs_update_identity
  ON yjs_doc_updates(workspace_id, note_id, device_id, clock);
CREATE INDEX IF NOT EXISTS idx_yjs_updates_pull
  ON yjs_doc_updates(workspace_id, note_id, ts, clock);
```

Register migration `002-sync-protocol.sql` using the existing migration loader. Preserve existing rows and initialize their workspace state as `initialized` only when existing Yjs data is present; otherwise use `empty`. Before creating `idx_yjs_update_identity`, deterministically retain the earliest row for each duplicate `(workspace_id, note_id, device_id, clock)` identity and delete later duplicates so the migration succeeds against the current prototype database.

- [ ] **Step 4: Implement idempotent persistence and continuation queries**

Use `INSERT OR IGNORE` for the unique identity, count inserted rows, and compute the returned checkpoint from accepted or already-present rows. `loadUpdatesAfter` must order by `ts ASC, clock ASC`, apply `(ts > checkpoint.ts OR ts = checkpoint.ts AND clock > checkpoint.sequence)`, and return `hasMore` by reading `limit + 1` rows.

- [ ] **Step 5: Run the tests and verify they pass**

Run: `npm test -- --runInBand test/yjs-persistence.test.js`.
Expected: PASS.

- [ ] **Step 6: Commit the backend persistence unit**

```bash
git add src/db/schema.sql src/db/migrations/002-sync-protocol.sql src/persistence/yjs.js test/yjs-persistence.test.js
git commit -m "feat: add durable sync state and idempotent journal"
```

## Task 2: Implement Explicit Sync State And Bootstrap API

**Files:**
- Create: `/Users/danielerolli/Documents/GitHub/Beaver-Sync/src/routes/sync-state.js`
- Modify: `/Users/danielerolli/Documents/GitHub/Beaver-Sync/src/server.js`
- Modify: `/Users/danielerolli/Documents/GitHub/Beaver-Sync/src/middleware/org.js`
- Test: `/Users/danielerolli/Documents/GitHub/Beaver-Sync/test/sync-state.test.js`

**Interfaces:**
- `GET /sync/state?workspaceId=...` returns `{ workspaceId, status, generation, documents, vault }`.
- `POST /sync/initialize/claim` accepts `{ workspaceId }` and returns `{ token, expiresAt }` or `409 sync_already_initialized`.
- `POST /sync/initialize/complete` accepts `{ workspaceId, token, generation, documents }` and atomically marks the workspace initialized.
- All routes require authentication and explicit workspace membership. Only workspace owners can claim/complete initialization.

- [ ] **Step 1: Write failing route tests for membership and seed locking**

Cover: member can read state, non-member receives `403`, owner claims an empty workspace, a second claim receives `409`, an expired claim can be reclaimed, and completion with the wrong token is rejected.

- [ ] **Step 2: Run the route tests and verify they fail**

Run: `npm test -- --runInBand test/sync-state.test.js`.
Expected: FAIL because the routes are not registered.

- [ ] **Step 3: Implement state reads and transactional claim/complete**

Use a random claim token, a five-minute expiry, and a SQLite transaction. `complete` must verify the token, verify that every declared snapshot generation is represented, and update status/generation in one transaction.

- [ ] **Step 4: Register the route and enforce membership**

Do not use workspace existence as authorization. Reuse the existing membership model and role checks, then register the route under `/sync` in `server.js`.

- [ ] **Step 5: Run the tests and verify they pass**

Run: `npm test -- --runInBand test/sync-state.test.js`.
Expected: PASS.

- [ ] **Step 6: Commit the bootstrap API**

```bash
git add src/routes/sync-state.js src/server.js src/middleware/org.js test/sync-state.test.js
git commit -m "feat: add explicit sync bootstrap state"
```

## Task 3: Replace Yjs Push/Pull With Idempotent Continuation Contracts

**Files:**
- Modify: `/Users/danielerolli/Documents/GitHub/Beaver-Sync/src/routes/yjs-sync.js`
- Modify: `/Users/danielerolli/Documents/GitHub/Beaver-Sync/src/persistence/yjs.js`
- Test: `/Users/danielerolli/Documents/GitHub/Beaver-Sync/test/yjs-sync.test.js`

**Interfaces:**
- `POST /yjs/push-batch` accepts `{ workspaceId, notes: [{ noteId, updates: [{ key, data, deviceId, sequence, ts }] }] }` and returns `{ accepted, duplicate, sizeBytes, checkpoint }`.
- `POST /yjs/pull-batch` accepts `{ workspaceId, notes: [{ noteId, checkpoint, limit }] }` and returns `{ notes: { [noteId]: { updates, nextCheckpoint, hasMore } } }`.
- Existing legacy timestamp-only behavior is removed rather than silently maintained as a second protocol.

- [ ] **Step 1: Write failing API tests**

Test successful push, replayed push, invalid device/header mismatch, non-member read/write, viewer write rejection, paged pull, and retrying the same pull checkpoint.

- [ ] **Step 2: Run the tests and verify they fail**

Run: `npm test -- --runInBand test/yjs-sync.test.js`.
Expected: FAIL against the current request and response shapes.

- [ ] **Step 3: Add strict schemas and identity validation**

Require `deviceId` and `sequence` in each update, require `deviceId` to match `X-Device-Id`, reject malformed keys, and keep request body limits below the configured 10 MB ceiling. Validate each workspace membership and role before reading or writing.

- [ ] **Step 4: Implement idempotent push response**

Store rows transactionally, distinguish accepted versus duplicate identities, increment quota only for accepted bytes, and update device last-seen metadata after the transaction succeeds.

- [ ] **Step 5: Implement continuation pull response**

Return `limit` updates plus `nextCheckpoint` and `hasMore`. Never return a successful completed state when more rows remain. Keep the maximum server page bounded and let the client request the next page.

- [ ] **Step 6: Run the tests and verify they pass**

Run: `npm test -- --runInBand test/yjs-sync.test.js`.
Expected: PASS.

- [ ] **Step 7: Commit the sync API**

```bash
git add src/routes/yjs-sync.js src/persistence/yjs.js test/yjs-sync.test.js
git commit -m "feat: make Yjs sync idempotent and paginated"
```

## Task 4: Implement Snapshot Generation And Safe Compaction

**Files:**
- Create: `/Users/danielerolli/Documents/GitHub/Beaver-Sync/src/lib/sync-snapshots.js`
- Modify: `/Users/danielerolli/Documents/GitHub/Beaver-Sync/src/hocuspocus.js`
- Modify: `/Users/danielerolli/Documents/GitHub/Beaver-Sync/src/lib/yjs-recovery.js`
- Test: `/Users/danielerolli/Documents/GitHub/Beaver-Sync/test/sync-snapshots.test.js`

**Interfaces:**
- `writeDocumentSnapshot({ workspaceId, noteId, generation, state })` returns `{ key, generation }` only after R2 verification.
- `recoverDocument(workspaceId, noteId)` merges journal rows, writes a new snapshot, updates document state, and deletes superseded journal rows only after verification.

- [ ] **Step 1: Write failing snapshot tests**

Cover successful generation writes, R2 write failure preserving journal rows, recovery after interrupted compaction, and generation mismatch rejection.

- [ ] **Step 2: Run the tests and verify they fail**

Run: `npm test -- --runInBand test/sync-snapshots.test.js`.
Expected: FAIL because the snapshot module does not exist.

- [ ] **Step 3: Implement versioned R2 writes**

Write to `yjs/{workspaceId}/{noteId}/{generation}.yjs`, verify object existence/size, then update `sync_document_state` in SQLite. Keep prior generations until the new generation is advertised.

- [ ] **Step 4: Update Hocuspocus and recovery**

Use the shared snapshot module from `onStoreDocument`, `onLoadDocument`, and startup recovery. Do not clear journal rows from `onStoreDocument` before the snapshot module confirms durable promotion.

- [ ] **Step 5: Run the tests and verify they pass**

Run: `npm test -- --runInBand test/sync-snapshots.test.js`.
Expected: PASS.

- [ ] **Step 6: Commit snapshot safety**

```bash
git add src/lib/sync-snapshots.js src/hocuspocus.js src/lib/yjs-recovery.js test/sync-snapshots.test.js
git commit -m "feat: make Yjs snapshots recoverable and versioned"
```

## Task 5: Add Remote Vault-Key Bootstrap Integration

**Files:**
- Modify: `/Users/danielerolli/Documents/GitHub/Beaver-Notes/src/utils/sync/vault-key-params.js`
- Modify: `/Users/danielerolli/Documents/GitHub/Beaver-Notes/src/lib/api/client.js`
- Modify: `/Users/danielerolli/Documents/GitHub/Beaver-Notes/src/composable/useOnboardingFlow.js`
- Test: `/Users/danielerolli/Documents/GitHub/Beaver-Notes/src/utils/sync/__tests__/vault-key-params.spec.js`

**Interfaces:**
- `fetchCloudKeyParams({ force })` uses the authenticated workspace vault endpoint and writes the same local `BeaverNotesSync/keyParams.json` shape used by folder sync.
- `publishCloudKeyParams()` publishes the local key parameters through the same vault contract and never sends a plaintext passphrase outside the existing verification API.
- Onboarding enters `vaultJoinMode` when remote key parameters exist and blocks sync until local key reconciliation succeeds.

- [ ] **Step 1: Extend tests for remote-only mode**

Add tests with no configured folder path: remote key parameters are fetched, local key parameters are written, missing remote parameters return `null`, and incorrect passphrases prevent join completion.

- [ ] **Step 2: Run the tests and verify they fail**

Run: `yarn vitest run src/utils/sync/__tests__/vault-key-params.spec.js` in Beaver Notes.
Expected: FAIL because the helper currently requires a sync folder and uses the reserved-Yjs-key fallback.

- [ ] **Step 3: Use the dedicated `/vault/:workspaceId/key-params` and `/vault/:workspaceId/verify` contracts**

Resolve `workspaceStore.activeId`, call the API client with the active account server URL, preserve the folder file format locally, and keep the existing passphrase prompt/reconciliation behavior.

- [ ] **Step 4: Run the tests and verify they pass**

Run: `yarn vitest run src/utils/sync/__tests__/vault-key-params.spec.js`.
Expected: PASS.

- [ ] **Step 5: Commit the vault bootstrap unit**

```bash
git add src/utils/sync/vault-key-params.js src/composable/useOnboardingFlow.js src/utils/sync/__tests__/vault-key-params.spec.js
git commit -m "feat: bootstrap remote vault keys like folder sync"
```

## Task 6: Update Beaver Notes Remote Transport And Engine Checkpoints

**Files:**
- Modify: `/Users/danielerolli/Documents/GitHub/Beaver-Notes/src/utils/sync/remote-yjs.js`
- Modify: `/Users/danielerolli/Documents/GitHub/Beaver-Notes/src/utils/sync/transports/cloud.js`
- Modify: `/Users/danielerolli/Documents/GitHub/Beaver-Notes/src/utils/sync/engine.js`
- Modify: `/Users/danielerolli/Documents/GitHub/Beaver-Notes/src/utils/sync/sync-repository.js`
- Test: `/Users/danielerolli/Documents/GitHub/Beaver-Notes/src/utils/sync/__tests__/transports/cloud.spec.js`
- Test: `/Users/danielerolli/Documents/GitHub/Beaver-Notes/src/utils/sync/__tests__/engine.spec.js`

**Interfaces:**
- `remote-yjs.js` exposes `pushUpdates(workspaceId, notes)` and `pullUpdates(workspaceId, notes)` using the new request/response shapes.
- `CloudTransport.pull(cursors)` returns updates and per-note continuation cursor deltas.
- `CloudTransport.push(cursors, opts)` returns accepted/duplicate counts and advances only acknowledged device sequences.
- Cursor storage uses `{ [workspaceId]: { [noteId]: { [deviceId]: { ts, sequence } } } }` for remote mode.

- [ ] **Step 1: Write failing client tests**

Cover a remote-only fresh device with server-discovered documents, continuation paging, duplicate push acknowledgements, failed push preserving pending data, and no calls into the folder transport.

- [ ] **Step 2: Run the focused tests and verify they fail**

Run: `yarn vitest run src/utils/sync/__tests__/transports/cloud.spec.js src/utils/sync/__tests__/engine.spec.js`.
Expected: FAIL against the legacy cursor and response behavior.

- [ ] **Step 3: Implement API response normalization**

Decode each returned update, preserve its note/device/sequence identity, and return continuation metadata to the transport. Do not swallow decrypt failures; return a key-unlock/decryption-blocked result to the engine.

- [ ] **Step 4: Remove cloud-only directory discovery from the remote path**

Use the server workspace document list/state endpoint for initial discovery. Leave `LocalFolderTransport`, `seedOnce`, and folder path resolution unchanged.

- [ ] **Step 5: Make engine application and cursor advancement transactional in order**

For each page, apply the Yjs update, append it locally, then merge the cursor. Save cursors after the page. Continue until `hasMore` is false. On failure, leave the last saved cursor unchanged.

- [ ] **Step 6: Add explicit sync status results**

Expose `syncing`, `offline`, `retrying`, `unlock-required`, `authorization-failed`, and `complete` through the existing sync event channel without logging payloads.

- [ ] **Step 7: Run the focused tests and verify they pass**

Run: `yarn vitest run src/utils/sync/__tests__/transports/cloud.spec.js src/utils/sync/__tests__/engine.spec.js`.
Expected: PASS.

- [ ] **Step 8: Commit the client protocol unit**

```bash
git add src/utils/sync/remote-yjs.js src/utils/sync/transports/cloud.js src/utils/sync/engine.js src/utils/sync/sync-repository.js src/utils/sync/__tests__/transports/cloud.spec.js src/utils/sync/__tests__/engine.spec.js
git commit -m "feat: use durable remote sync checkpoints"
```

## Task 7: Add Cross-Repository API And Regression Coverage

**Files:**
- Create: `/Users/danielerolli/Documents/GitHub/Beaver-Sync/test/remote-bootstrap.integration.test.js`
- Create: `/Users/danielerolli/Documents/GitHub/Beaver-Notes/src/utils/sync/__tests__/remote-bootstrap.spec.js`
- Modify: `/Users/danielerolli/Documents/GitHub/Beaver-Sync/package.json`
- Modify: `/Users/danielerolli/Documents/GitHub/Beaver-Notes/package.json`

**Interfaces:**
- Backend integration tests start an isolated API with temporary SQLite and R2-compatible storage.
- Client tests use a deterministic fake server implementing the exact bootstrap, push, and pull contracts from Tasks 2 and 3.

- [ ] **Step 1: Add the backend bootstrap-to-pull integration scenario**

Create an empty workspace, claim initialization, complete initialization with one document, push two updates, replay one update, and pull with a page size of one. Assert one accepted replay is duplicate and the continuation returns every update exactly once.

- [ ] **Step 2: Add the client new-instance scenario**

Start with empty local metadata, provide remote vault parameters and two encrypted documents, run the bootstrap/pull cycle, and assert local Yjs application, asset scheduling, and final cursor state.

- [ ] **Step 3: Add folder transport regression assertions**

Run the existing local-folder and transport tests unchanged. The plan must not alter their fixtures or expected request behavior.

- [ ] **Step 4: Run both suites**

Run: `npm test` in Beaver Sync and `yarn vitest run` in Beaver Notes.
Expected: PASS with no folder transport regressions.

- [ ] **Step 5: Commit integration coverage**

```bash
git add test/remote-bootstrap.integration.test.js package.json src/utils/sync/__tests__/remote-bootstrap.spec.js
git commit -m "test: cover remote sync bootstrap and propagation"
```

## Task 8: Validate Against Live Fly.io Service And VM Instance

**Files:**
- Create: `/Users/danielerolli/Documents/GitHub/Beaver-Notes/docs/superpowers/plans/live-validation-runbook.md`
- Modify: `/Users/danielerolli/Documents/GitHub/Beaver-Sync/docs/README.md` only if deployment commands or persistent-volume requirements change

- [ ] **Step 1: Create a dedicated test workspace on the live service**

Record workspace ID, account/device labels, server release, and test start time. Do not use destructive operations against the populated production workspace.

- [ ] **Step 2: Run populated-local seed**

Enable `remote` transport on the populated local instance, force a sync, and capture only operation metadata: counts, bytes, duration, retry count, and final state.

- [ ] **Step 3: Run VM join**

Authenticate the VM instance, enter the existing vault passphrase through the normal join flow, force a pull, and verify note/folder/label/asset counts against the source instance.

- [ ] **Step 4: Run bidirectional edits**

Edit one note on local, verify it on VM, edit a different note on VM, verify it locally, then perform concurrent edits and compare Yjs convergence.

- [ ] **Step 5: Run failure scenarios**

Interrupt a push, restart the client, retry; interrupt a pull, restart the client, retry; temporarily make R2 unavailable while preserving SQLite; verify no false success and eventual convergence.

- [ ] **Step 6: Record cost and reliability measurements**

Record API request counts, SQLite update counts, R2 GET/PUT counts, transferred bytes, P50/P95 sync duration, retry count, and final convergence time. Use these values as the phase-one baseline for Fly.io/R2 tuning.

- [ ] **Step 7: Commit the runbook and results**

```bash
git add docs/superpowers/plans/live-validation-runbook.md
git commit -m "docs: add Beaver Sync live validation runbook"
```

## Final Verification

- [ ] Run backend unit and integration tests.
- [ ] Run client unit tests, including existing folder transport tests.
- [ ] Run lint/type checks already configured by both repositories.
- [ ] Inspect `git status --short` and confirm only intended files are changed.
- [ ] Review the entire diff for accidental folder transport modifications.
- [ ] Run the live validation runbook with the populated local instance and Linux VM.
- [ ] Record any residual limitations before claiming phase-one completion.
