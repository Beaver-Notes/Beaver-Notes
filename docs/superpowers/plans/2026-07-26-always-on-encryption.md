# Always-On Encryption Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make app-level encryption always-on by default — no opt-in step, auto-generated key, and all data encrypted at rest (notes, assets, sync payloads, metadata).

**Architecture:** The existing encryption infrastructure (Argon2id KDF → items key → AES-256-GCM/XChaCha20-Poly1305) stays intact. The only change is removing the opt-in gate and auto-triggering encryption on first launch. A random passphrase is generated and stored in the OS keyring; cross-device distribution reuses the existing `keyParams.json` (folder sync) and a new remote API endpoint (server sync).

**Tech Stack:** TypeScript/JavaScript (frontend), Rust (Tauri backend), Web Crypto API, Argon2id, AES-256-GCM, XChaCha20-Poly1305, SQLite.

---

## Global Constraints

- No user-facing passphrase prompt for encryption setup
- Encryption manifest auto-created on first launch
- Existing plaintext notes must be retroactively encrypted on upgrade
- All data (notes, assets, sync, metadata) encrypted at rest
- Both folder sync and server-based sync key distribution must work
- Tests must cover encryption round-trips and migration correctness

---

### Task 1: Auto-generate encryption passphrase on first launch

**Files:**
- Modify: `src/utils/crypto/encryption.js` (lines 51-73 — `setupEncryption`)
- Modify: `src/lib/native/security.js` (lines 44-46 — `getEncryptionState`)
- Modify: `src-tauri/src/commands/security.rs` (lines 177-192 — `encryption_get_state`)
- Modify: `src/composable/useOnboardingFlow.js` (lines 117-150 — encryption step)
- Modify: `src/composable/useSettingsSecurity.js` (lines 63-99 — setup flow)

**Interfaces:**
- `setupEncryption(passphrase)` → now also handles auto-generation (no passphrase = generate random)
- `getEncryptionState()` → still returns `{ enabled, unlocked }` but `enabled` is always `true` after first launch
- `encryption_submitPassword(password, createIfMissing)` → when `createIfMissing=true` and no manifest exists, auto-generates a random passphrase instead of prompting

**Notes:**
- The random passphrase should be a 32-character cryptographically random string (use `crypto.getRandomValues`)
- Stored in secure blob storage via `persistSecureBlobInBackground` (already implemented)
- The manifest creation path in `keys.rs` (`create_encryption_manifest`) is reused as-is

- [ ] **Step 1: Add `generateRandomPassphrase()` to `encryption.js`**

```js
function generateRandomPassphrase() {
  const buf = new Uint8Array(32);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('');
}
```

- [ ] **Step 2: Modify `setupEncryption(passphrase)` to auto-generate when no passphrase**

Change the function so that when `passphrase` is empty/omitted, it generates a random one and proceeds with manifest creation. The passphrase is stored in secure blob.

- [ ] **Step 3: Modify `ensureKeyReadyForWrite()` to auto-setup if encryption not configured**

When `!next?.enabled`, call `setupEncryption(generateRandomPassphrase())` automatically. Return `true` once done.

- [ ] **Step 4: Run existing tests**

Run the characterization tests in `src-tauri/src/shared/crypto/tests.rs` to verify no regression.

- [ ] **Step 5: Commit**

```bash
git add src/utils/crypto/encryption.js src/lib/native/security.js src-tauri/src/commands/security.rs src/composable/useOnboardingFlow.js src/composable/useSettingsSecurity.js
git commit -m "feat: auto-generate encryption passphrase on first launch"
```

---

### Task 2: Remove all `isEncryptionEnabled()` early-return gates from save/sync paths

**Files:**
- Modify: `src/utils/note/serializer.js` (line 189 — `encryptNoteForStorage`)
- Modify: `src/utils/sync/crypto.js` (lines 26, 75-78 — `encryptJSON`, `syncAssetName`)
- Modify: `src/utils/assets/storage.js` (lines 76, 109 — `skipAssetEncryption`)
- Modify: `src/store/note/index.ts` (line 521 — skip check for `isEncryptedContent`)
- Modify: `src-tauri/src/shared/crypto/keys.rs` (lines 699, 702-703 — `encrypt_note_row_for_storage` early return for non-active session)
- Modify: `src-tauri/src/shared/crypto/assets.rs` (lines 251-253 — `encrypt_asset` skip check)

**Interfaces:**
- `encryptNoteForStorage(note)` → always encrypts when key is available; throws if key is locked (not silently returns plaintext)
- `encryptJSON(obj, aad)` → always encrypts; throws if key locked
- `syncAssetName(localFilename)` → always appends `.enc` when encryption is in manifest
- `encrypt_asset()` → always encrypts local assets when manifest exists
- `encrypt_note_row_for_storage()` → always encrypts note rows when session is active

**Notes:**
- The `skipAssetEncryption` parameter in `fs.rs` can be removed entirely (always encrypt when manifest exists)
- `encryptNoteForStorage` should be `await`ed in the note save path — currently it's imported but never called in `saveNote`

- [ ] **Step 1: Remove `isEncryptionEnabled()` gate from `encryptNoteForStorage`**

Change `if (!isEncryptionEnabled()) return note;` to always encrypt. If key is locked, throw an error (let the caller handle it).

- [ ] **Step 2: Remove `isEncryptionEnabled()` gate from `encryptJSON` in `sync/crypto.js`**

Change `if (!isEncryptionEnabled()) return JSON.stringify(obj);` to always call `syncEncryptPayload`.

- [ ] **Step 3: Remove `isEncryptionEnabled()` gate from asset encryption in `storage.js`**

Change `skipAssetEncryption: !isEncryptionEnabled()` to always `false` (never skip when manifest exists).

- [ ] **Step 4: Remove `isEncryptedContent` bypass in `note/index.ts` save path**

Ensure `encryptNoteForStorage` is called for all note saves (currently it's exported but never wired into `saveNote` or `updateNote`). Add the call in the note persist path.

- [ ] **Step 5: Remove early return in `encrypt_note_row_for_storage` for non-active session**

Change the guard so that encryption always happens when a manifest exists (not just when session is active — the session should always be active if a manifest exists).

- [ ] **Step 6: Remove `skip_asset_encryption` from `fs.rs` and `assets.rs`**

Delete the `skip_asset_encryption` parameter and related logic. Assets are always encrypted when a manifest exists.

- [ ] **Step 7: Run existing tests**

Verify no regressions in note save, sync, and asset paths.

- [ ] **Step 8: Commit**

```bash
git add src/utils/note/serializer.js src/utils/sync/crypto.js src/utils/assets/storage.js src/store/note/index.ts src-tauri/src/shared/crypto/keys.rs src-tauri/src/shared/crypto/assets.rs src-tauri/src/commands/fs.rs
git commit -m "feat: always encrypt notes, sync payloads, and assets — remove opt-out gates"
```

---

### Task 3: Remove encryption setup step from onboarding flow

**Files:**
- Modify: `src/composable/useOnboardingFlow.js` (lines 117-150, 270-294 — encryption step removal)
- Modify: `src/composable/useSettingsSecurity.js` (lines 92-187 — change encryption passphrase change to be a no-op or auto-managed)

**Interfaces:**
- `useOnboardingFlow.js`: Remove the `encryptionPassword`, `encryptionConfirmPassword`, `encryptionPasswordError`, `encryptionPasswordLoading` state and `setupEncryptionPassword()` function
- `useOnboardingFlow.js`: Remove `'password'` from the `activeFlow` steps arrays
- `useSettingsSecurity.js`: Remove `changeEncryptionPassphrase()` function (encryption key rotates automatically)

**Notes:**
- The encryption passphrase is auto-generated and stored; users never see or type it
- Key rotation still works but is triggered automatically (e.g., on key compromise detected)

- [ ] **Step 1: Remove encryption password state from `useOnboardingFlow.js`**

Delete lines 117-150 (encryption password refs, error, loading, `setupEncryptionPassword` function).

- [ ] **Step 2: Remove `'password'` from onboarding flow step arrays**

Update all `activeFlow` computed values in `useOnboardingFlow.js` to remove `'password'` from step arrays (lines 270-294).

- [ ] **Step 3: Remove `changeEncryptionPassphrase` from `useSettingsSecurity.js`**

Delete the function and its return in the `useSettingsSecurity` hook. Remove `changeEncryptionPassphrase` from the returned object.

- [ ] **Step 4: Remove encryption step from settings UI template**

Remove references to `changeEncryptionPassphrase` and `lockNow` from `useSettingsSecurity.js` return object and UI bindings.

- [ ] **Step 5: Run existing tests**

Verify onboarding flow still works without the encryption step.

- [ ] **Step 6: Commit**

```bash
git add src/composable/useOnboardingFlow.js src/composable/useSettingsSecurity.js
git commit -m "feat: remove encryption setup step from onboarding and settings"
```

---

### Task 4: Retroactive migration of existing plaintext notes

**Files:**
- Modify: `src/store/note/encryption.ts` (existing batch helpers)
- Modify: `src/store/note/index.ts` (add migration trigger on first run after upgrade)
- Modify: `src/utils/note/serializer.js` (add migration status tracking)

**Interfaces:**
- `migrateExistingNotes(state)` → detects unencrypted notes, encrypts them in background batches
- Called once on app startup after detecting a version upgrade
- Progress reported via `EncryptionProgress` events

**Notes:**
- Reuse `decryptAllNotesForAppEncryption` and `persistAllNotesForAppEncryption` from `encryption.ts`
- Run in background with `requestIdleCallback` or `setTimeout` yielding to avoid blocking UI
- Track migration status in `localStorage` or a flag file to avoid re-running

- [ ] **Step 1: Add migration status tracking to `migration.ts` or `serializer.js`**

Store a migration version marker (e.g., `encryption-migration: v1`) to track whether migration has been run.

- [ ] **Step 2: Add `runMigrateExistingNotes()` to `note/encryption.ts`**

Uses `decryptAllNotesForAppEncryption` then `persistAllNotesForAppEncryption` in sequence with progress callbacks.

- [ ] **Step 3: Add migration trigger in `note/index.ts` on app startup**

Check if migration marker exists and encryption is now always-on. If migration not yet run, trigger in background.

- [ ] **Step 4: Run existing tests**

Verify migration doesn't corrupt notes on interruption.

- [ ] **Step 5: Commit**

```bash
git add src/store/note/encryption.ts src/store/note/index.ts src/utils/note/serializer.js
git commit -m "feat: add retroactive migration of existing plaintext notes"
```

---

### Task 5: Encrypt KV metadata (titles, previews) at rest

**Files:**
- Modify: `src-tauri/src/shared/crypto/keys.rs` (lines 609-637 — extend `encrypt_note_content_for_storage`)
- Modify: `src-tauri/src/shared/crypto/keys.rs` (lines 639-691 — extend `decrypt_native_note_content`)
- Modify: `src-tauri/src/commands/storage.rs` — encrypt/decrypt metadata in `kv` table
- Modify: `src/store/note/index.ts` — handle encrypted metadata on load

**Interfaces:**
- `encrypt_note_content_for_storage` continues to work for Yjs blobs
- New function `encrypt_kv_metadata(state, key, obj)` encrypts the entire value JSON for `kv` table
- New function `decrypt_kv_metadata(state, key, value)` decrypts and returns parsed JSON
- Note titles stored in kv are encrypted alongside content

**Notes:**
- This closes the biggest info-leak gap (note titles visible in kv table)
- The `notes_fts` full-text search index still stores plaintext as a trade-off; search must decrypt to index (see Task 6 for mitigation)

- [ ] **Step 1: Add `encrypt_kv_entry` function to `keys.rs`**

Takes a key prefix (e.g., `notes.<id>`) and a JSON value, encrypts with AES-256-GCM, returns a marker-prefixed blob (e.g., `{ "ek": 1, "iv": hex, "cipher": base64 }`).

- [ ] **Step 2: Add `decrypt_kv_entry` function to `keys.rs`**

Detects `ek: 1` marker, decrypts, returns plaintext JSON. Passes through unencrypted values for non-note keys.

- [ ] **Step 3: Wrap `db_insert`/`db_get` for note keys**

In `mod.rs`, modify `db_get` and `db_insert` (or add wrapper functions) that auto-encrypt/decrypt for keys starting with `notes.`.

- [ ] **Step 4: Update frontend to handle encrypted kv values on load**

In `note/index.ts`, when loading from KV, decrypt note metadata before hydrating.

- [ ] **Step 5: Run existing tests**

Verify existing characterization tests and kv read/write paths.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/shared/crypto/keys.rs src-tauri/src/commands/storage.rs src/store/note/index.ts
git commit -m "feat: encrypt KV metadata (note titles, previews) at rest"
```

---

### Task 6: Server-based sync key distribution

**Files:**
- Modify: `src-tauri/src/shared/crypto/keys.rs` (add `server_key_params_path` and `publish_key_params_to_server`)
- Modify: `src-tauri/src/commands/security.rs` (add `sync_publish_key_params` command)
- Modify: `src/utils/sync/remote.js` (add `remoteKeyParams` API calls)
- Modify: `src/utils/sync/index.js` (add keyParams sync for server path)

**Interfaces:**
- `publish_key_params_to_server(app, state)` → uploads wrapped key params to the Beaver Sync server via HTTP API
- `fetch_key_params_from_server(app)` → downloads remote key params for new device join
- Reuses the existing `KeyParams` struct — no new schema needed on the server side

**Notes:**
- The server-side storage for key params is out of scope; the frontend uploads encrypted key params as part of regular sync data
- A new endpoint `POST /sync/key-params` and `GET /sync/key-params` is assumed on the Beaver Sync server
- The key params are encrypted with the user's account key (or stored in the sync folder equivalent on the server)

- [ ] **Step 1: Add `server_key_params_path` to `keys.rs`**

Returns the path within the sync root for key params (same format as folder sync, but used for HTTP upload).

- [ ] **Step 2: Add `remoteKeyParams` API functions to `remote.js`**

```js
export async function remoteKeyParamsUpload(params) {
  const client = getRemoteClient();
  await client.post('/sync/key-params', { params });
}
export async function remoteKeyParamsDownload() {
  const client = getRemoteClient();
  return client.get('/sync/key-params');
}
```

- [ ] **Step 3: Add keyParams sync to `sync/index.js` server path**

In the server sync section, after existing sync operations, upload/download key params.

- [ ] **Step 4: Add Tauri command for server key params**

In `security.rs`, add `sync_publish_key_params` and `sync_fetch_key_params` commands that delegate to Rust `keys.rs` functions.

- [ ] **Step 5: Run existing tests**

Verify folder sync keyParams still works; server sync keyParams upload/download added.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/shared/crypto/keys.rs src-tauri/src/commands/security.rs src/utils/sync/remote.js src/utils/sync/index.js
git commit -m "feat: add server-based sync key distribution for always-on encryption"
```

---

### Task 7: Harden password store (always encrypt, remove plaintext fallback)

**Files:**
- Modify: `src/store/passwd.ts` (lines 53-91 — remove raw hash fallback)

**Interfaces:**
- `retrieve()` → always decrypts; throws if decryption fails and no keyring available
- `setAppPassword()` → always encrypts; never writes raw hash to disk

**Notes:**
- The `$2a$`/`$2b$` raw hash path in `passwd.ts` is the plaintext fallback that must be removed
- If keyring is unavailable, the app should error loudly rather than store the hash in plaintext

- [ ] **Step 1: Remove raw hash fallback in `passwd.ts` `retrieve()`**

Delete the `trim.startsWith('$2a$')` etc. logic. If decryption fails and no encryption is available, throw an error.

- [ ] **Step 2: Remove raw hash fallback in `passwd.ts` `importAppPassword()`**

Same — always route through `setAppPassword` which encrypts.

- [ ] **Step 3: Run existing tests**

Verify password store still works for valid use cases.

- [ ] **Step 4: Commit**

```bash
git add src/store/passwd.ts
git commit -m "feat: harden password store — remove plaintext hash fallback"
```

---

### Task 8: Wipe decryption caches on app background/suspend

**Files:**
- Modify: `src/composable/useNoteEncryption.js` (add visibility change listener)
- Modify: `src/utils/crypto/encryption.js` (export `clearDecryptedCaches` for direct use)
- Modify: `src-tauri/src/shared/cache.rs` (expose `clear_decrypted_caches` for Tauri commands)

**Interfaces:**
- When app goes to background (`visibilitychange` event), clear decrypted note and asset caches
- `clearDecryptedCaches()` is already implemented in Rust (`encryption_clear_decrypted_caches`)

**Notes:**
- This is a defensive measure — decrypted content should not persist in memory when the app is not visible

- [ ] **Step 1: Add `visibilitychange` listener in `useNoteEncryption.js`**

```js
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    clearDecryptedCaches().catch(() => {});
  }
});
```

- [ ] **Step 2: Expose `clear_decrypted_caches` for direct import**

Already exists via `@/lib/native/security`. Verify it's imported and called correctly.

- [ ] **Step 3: Run existing tests**

Verify no cache-related regressions.

- [ ] **Step 4: Commit**

```bash
git add src/composable/useNoteEncryption.js src/utils/crypto/encryption.js
git commit -m "feat: wipe decryption caches on app background/suspend"
```

---

### Task 9: Tests and verification

**Files:**
- Test: `src-tauri/src/shared/crypto/tests.rs` (add characterization tests)
- Test: `tests/encryption-always-on.spec.ts` (new e2e test file)

**Interfaces:**
- Characterization tests for new encryption paths (auto-manifest creation, KV metadata encryption)
- E2E test verifying notes encrypt automatically on save when no passphrase was set
- Migration test verifying plaintext notes are re-encrypted on upgrade

**Notes:**
- Reuse existing characterization test patterns from `tests.rs`
- Add test for cross-device key distribution (folder sync and server sync)

- [ ] **Step 1: Add test for auto-manifest creation**

```rust
#[test]
fn auto_manifest_creation_generates_key() {
    // Verify that calling setup without a passphrase creates a manifest
}
```

- [ ] **Step 2: Add test for KV metadata encryption round-trip**

```rust
#[test]
fn kv_metadata_encrypt_decrypt_round_trip() {
    // Encrypt and decrypt a metadata blob
}
```

- [ ] **Step 3: Add e2e test for auto-encryption on note save**

```ts
test('notes are encrypted automatically without user setup', async () => {
    const note = await createNote({ title: 'Test' });
    const stored = await getKvNote(note.id);
    expect(stored.content.ae).toBeDefined();
});
```

- [ ] **Step 4: Run all tests**

```bash
cargo test --package beaver-notes
npm run test:e2e
```

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/shared/crypto/tests.rs tests/encryption-always-on.spec.ts
git commit -m "test: add tests for always-on encryption"
```

---

## Task Dependency Graph

```
Task 1 (auto-generate passphrase)
  ├─ Task 3 (remove onboarding step) — depends on T1
  ├─ Task 7 (harden password store) — depends on T1 (auto passphrase is now in keyring)
  └─ Task 9 (tests) — depends on T1..T8

Task 2 (remove early-return gates) — can run in parallel with T1
  └─ Task 4 (retroactive migration) — depends on T2 (encryption always on)

Task 5 (encrypt KV metadata) — can run in parallel with T2
Task 6 (server sync key distribution) — can run in parallel with T2

Task 8 (cache wipe on suspend) — independent
```

## Recommended Execution Order

1. **Task 1** + **Task 3** (auto-generate passphrase + remove onboarding) — core behavior change
2. **Task 2** + **Task 5** + **Task 6** (remove opt-out gates + encrypt metadata + server key dist) — can run parallel
3. **Task 4** (retroactive migration) — depends on T2
4. **Task 7** (harden password store) — depends on T1
5. **Task 8** (cache wipe) — independent, easy win
6. **Task 9** (tests) — final verification
