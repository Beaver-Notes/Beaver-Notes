import { Transport } from './transport.js';
import {
  pushUpdates as remotePushUpdates,
  pullUpdates as remotePullUpdates,
  getRemoteState,
  claimInitialization,
  completeInitialization,
  getSnapshotUrls,
  getSnapshotDownloadUrls,
} from '../remote-yjs.js';
import {
  listRemoteAssets,
  uploadAsset,
  batchUploadAssets,
  seedBatchUploadAssets,
  downloadAsset,
  encodeAssetKey,
  decodeAssetKey,
  presignGetBatch,
} from '../remote-assets.js';
import { parseSyncFilename } from '../sync-yjs.js';
import { getSyncDeviceId, getCommitsDir } from '../sync-repository.js';
import { getSyncPath } from '../path.js';
import { isNonNegativeInteger, toUpdateBytes, buildAadSuffix, seedOnce as seedOnceCommits } from '../shared.js';
import { YJS_UPDATE_EXT, ASSET_TYPES } from '../constants.js';
import { readDir, readFile, readFileBinaryBytes, writeFile as writeFs, ensureDir, pathExists, downloadUrl } from '@/lib/native/fs';
import { path } from '@/lib/tauri-bridge';
import { localAssetName } from '../crypto.js';
import { loadServerCheckpoint, saveServerCheckpoint, clearServerCheckpoint } from '../state-vector.js';
import { yMapToObj } from '@/lib/yjs/helpers.js';
import { getWorkspaceDoc } from '@/lib/yjs/meta-doc.js';
import { mergeIntoMap, reconcileUnknownNotePlaceholders } from '@/lib/yjs/workspace-doc';
import { useWorkspaceStore } from '@/store/workspace.ts';
import * as Y from 'yjs';
import { getSnapshot, getUpdates } from '@/lib/native/yjs.js';
import { toUint8Array, applyUpdatesToDoc } from '@/lib/yjs/helpers.js';
import { META_DOC_ID } from '@/lib/yjs/meta-doc.js';
import { logger } from '@/utils/logger';

const CLOUD_PUSH_MIN_INTERVAL_MS = 30_000;
const CLOUD_PUSH_MAX_BATCH_BYTES = 256 * 1024;
const CLOUD_PUSH_MAX_FILES_PER_POST = 50;

// Backend /seed-batch caps each request at SEED_BATCH_MAX_ITEMS (50) items
// and the route body limit is 100MB. The seed upload path must respect BOTH
// caps, otherwise size-packed batches exceed the item count and the server
// rejects them (400 too_many_items), failing the whole seed.
export const SEED_BATCH_MAX_ITEMS = 50;
export const SEED_BATCH_MAX_BYTES = 10 * 1024 * 1024;

export function buildSeedAssetBatches(entries, { maxItems = SEED_BATCH_MAX_ITEMS, maxBytes = SEED_BATCH_MAX_BYTES } = {}) {
  const sorted = [...entries].sort((a, b) => a.size - b.size);

  const batches = [];
  let currentBatch = [];
  let currentSize = 0;

  const flush = () => {
    if (currentBatch.length > 0) {
      batches.push(currentBatch);
      currentBatch = [];
      currentSize = 0;
    }
  };

  for (const entry of sorted) {
    if (entry.size > maxBytes) {
      flush();
      batches.push([entry]);
      continue;
    }
    if (currentBatch.length >= maxItems || currentSize + entry.size > maxBytes) {
      flush();
    }
    currentBatch.push(entry);
    currentSize += entry.size;
  }
  flush();

  return batches;
}

function acknowledgedCheckpoints(result, noteIds) {
  if (result?.checkpoints && typeof result.checkpoints === 'object') return result.checkpoints;
  if (result?.checkpoint && noteIds.length === 1) return { [noteIds[0]]: result.checkpoint };
  return {};
}

function malformedRemoteUpdate() {
  const error = new Error('Remote update payload is malformed');
  error.code = 'unlock-required';
  return error;
}

function isAuthoritativelyEmpty(state) {
  return isValidRemoteState(state) && state.status === 'empty' && state.documents.length === 0;
}

function isStalledInit(state) {
  return isValidRemoteState(state) && state.status === 'initializing' && state.documents.length === 0;
}

function isValidRemoteState(state) {
  const recognizedStatuses = new Set(['empty', 'initializing', 'initialized', 'recovering']);
  return state && recognizedStatuses.has(state.status) && Array.isArray(state.documents);
}

function malformedRemoteState() {
  const error = new Error('Remote sync state payload is malformed');
  error.code = 'sync-state-invalid';
  return error;
}

export class CloudTransport extends Transport {
  constructor() {
    super();
    this._lastPushedAt = 0;
    this._cloudBuffer = [];
    this._serverProbeComplete = false;
    this._failedDownloads = new Map();
    this._seedPromise = null;
    /** @type {{ syncAllowed: boolean, workspaceId: string|null }|null} */
    this._readiness = null;
  }

  /**
   * Inject the cycle-level readiness snapshot from `getSyncReadiness()`.
   * Called by the engine once per cycle so every cloud operation reads from
   * the same authoritative state instead of re-querying Pinia.
   */
  setReadiness(r) { this._readiness = r; }

  getCloudBuffer() {
    return this._cloudBuffer;
  }

  async _ensureWorkspace() {
    if (this._readiness?.workspaceId) return this._readiness.workspaceId;
    const workspaceStore = useWorkspaceStore();
    return workspaceStore.activeId || null;
  }

  async _bootstrapFromSnapshots(state) {
    const { emit } = await import('@tauri-apps/api/event');
    const workspaceId = await this._ensureWorkspace();
    if (!workspaceId) return false;

    const docs = (state.documents || []).filter(
      (d) => d.snapshotKey && d.noteId
    );
    if (docs.length === 0) return false;

    const { getSnapshots } = await import('@/lib/native/yjs.js');
    const allNoteIds = docs.map((d) => d.noteId);
    const localSnapshots = await getSnapshots(allNoteIds).catch(() => ({}));
    // A cached snapshot that no longer decodes as valid Yjs is worse than a
    // missing one: loadStateIntoDoc discards it and falls back to replay, but the
    // corrupt row persists and re-triggers the "Unknown content type" decode
    // error on every open. Treat a corrupt cached snapshot exactly like a
    // missing one so bootstrap re-downloads the server's authoritative copy and
    // overwrites the bad one (the bytes fed to Yjs must be valid Yjs binary —
    // a base64 string / JSON / half-decrypted blob would surface here as a
    // decode throw and is replaced, not applied).
    const cachedSnapshotIsCorrupt = (raw) => {
      if (!raw || raw.length === 0) return false;
      try {
        const probe = new Y.Doc();
        try {
          Y.applyUpdate(probe, toUint8Array(raw));
        } finally {
          probe.destroy();
        }
        return false;
      } catch {
        return true;
      }
    };
    const needsBootstrap = docs.filter(
      (d) =>
        !localSnapshots?.[d.noteId] ||
        localSnapshots[d.noteId].length === 0 ||
        cachedSnapshotIsCorrupt(localSnapshots[d.noteId])
    );

    if (needsBootstrap.length === 0) return false;
    logger.info(`[sync] bootstrap: ${needsBootstrap.length} notes need snapshot download`);

    const noteIdsForDownload = needsBootstrap.map((d) => d.noteId);
    const BATCH_SIZE = 50;
    const allUrls = {};

    for (let i = 0; i < noteIdsForDownload.length; i += BATCH_SIZE) {
      const batch = noteIdsForDownload.slice(i, i + BATCH_SIZE);
      try {
        const result = await getSnapshotDownloadUrls(workspaceId, batch);
        if (result?.urls) Object.assign(allUrls, result.urls);
      } catch (err) {
        console.warn('[sync] bootstrap: failed to get download URLs:', err?.message);
        return false;
      }
    }

    const urlEntries = Object.entries(allUrls);
    if (urlEntries.length === 0) {
      logger.info('[sync] bootstrap: no snapshot URLs returned');
      return false;
    }

    const { decryptBatch } = await import('../crypto.js');
    const downloadedItems = [];

    try { emit('sync:progress', { phase: 'bootstrap', processed: 0, total: urlEntries.length }); } catch {}

    const docByNoteId = new Map(docs.map((d) => [d.noteId, d]));
    for (let i = 0; i < urlEntries.length; i++) {
      const [noteId, { url, snapshotTs }] = urlEntries[i];
      // The seed encrypts content snapshots with AAD `${noteId}-${noteTs}`
      // where noteTs is the timestamp it stored on the document. The download
      // URL may return a *different* snapshotTs (server-generated), which would
      // cause an AAD mismatch. Keep the document's own timestamp so we can try
      // it as a decrypt candidate below.
      const docNoteTs = docByNoteId.get(noteId)?.noteTs ?? docByNoteId.get(noteId)?.snapshotTs;
      try {
        const response = await fetch(url);
        if (!response.ok) {
          console.warn(`[sync] bootstrap: download failed for ${noteId}: ${response.status}`);
          continue;
        }
        const blob = await response.blob();
        const arrayBuf = await blob.arrayBuffer();
        const envelope = new TextDecoder().decode(arrayBuf);
        downloadedItems.push({ _noteId: noteId, data: envelope, key: `bootstrap-${noteId}`, snapshotTs, noteTs: docNoteTs });
      } catch (err) {
        console.warn(`[sync] bootstrap: download error for ${noteId}:`, err?.message);
      }
      // Throttle: emit every 10 items and on last item
      if ((i + 1) % 10 === 0 || i === urlEntries.length - 1) {
        try {
          emit('sync:progress', { phase: 'bootstrap', processed: i + 1, total: urlEntries.length });
        } catch {}
      }
    }

    if (downloadedItems.length === 0) {
      logger.info('[sync] bootstrap: no snapshots downloaded');
      return false;
    }

    // The seed encrypts the content snapshot with AAD `${noteId}-${noteTs}`
    // (cloud.js:931, where noteTs is the timestamp stored on the document),
    // but `_bootstrapFromSnapshots` historically decrypted with
    // `${noteId}-${snapshotTs}` taken from the server (cloud.js:281). When
    // those two values differ, AES-GCM fails closed and decryptBatch returns
    // null, so bootstrap writes nothing and loadStateIntoDoc then falls back
    // to a stale/corrupt cached snapshot → Yjs decode error.
    //
    // To stay backward compatible with snapshots already stored under either
    // AAD, try each plausible suffix and accept the first that decrypts.
    const candidateSuffixesFor = (item) => {
      const suffixes = [`${item.snapshotTs}`];
      if (item.noteTs != null) suffixes.push(`${item.noteTs}`);
      suffixes.push('snapshot-', '0');
      return suffixes;
    };

    const decrypted = Array.from({ length: downloadedItems.length }, () => null);
    const suffixesByItem = downloadedItems.map(candidateSuffixesFor);
    const maxCandidates = suffixesByItem.reduce((m, s) => Math.max(m, s.length), 0);

    for (let c = 0; c < maxCandidates; c++) {
      const pending = [];
      for (let i = 0; i < downloadedItems.length; i++) {
        if (decrypted[i] == null && suffixesByItem[i][c] != null) pending.push(i);
      }
      if (pending.length === 0) break;
      const aads = pending.map(
        (i) => `${downloadedItems[i]._noteId}-${suffixesByItem[i][c]}`
      );
      const res = await decryptBatch(
        pending.map((i) => downloadedItems[i].data),
        aads
      );
      pending.forEach((i, k) => {
        if (res[k] != null) decrypted[i] = res[k];
      });
    }
    const { appendUpdate } = await import('@/lib/native/yjs.js');
    const { applyRemote } = await import('@/lib/yjs/shared.js');
    let applied = 0;

    for (let i = 0; i < decrypted.length; i++) {
      const item = decrypted[i];
      if (!item?.update) continue;
      try {
        const noteId = downloadedItems[i]._noteId;
        const updateBytes = item.update instanceof Uint8Array
          ? item.update
          : new Uint8Array(item.update);

        await appendUpdate(noteId, updateBytes, getSyncDeviceId());
        // Hydrate any active in-memory Y.Doc so editors show content
        // immediately without waiting for a full reload.
        applyRemote(noteId, updateBytes);
        applied++;
      } catch (err) {
        console.warn(`[sync] bootstrap: apply failed for ${downloadedItems[i]?._noteId}:`, err?.message);
      }
    }

    logger.info(`[sync] bootstrap: applied ${applied}/${downloadedItems.length} snapshots`);

    // Cache snapshots so getSnapshots() finds them next cycle and we
    // don't re-bootstrap endlessly.
    const { compactUpdates } = await import('@/lib/native/yjs.js');
    for (let i = 0; i < decrypted.length; i++) {
      const item = decrypted[i];
      if (!item?.update) continue;
      const noteId = downloadedItems[i]._noteId;
      try {
        const snapshotBytes = item.update instanceof Uint8Array
          ? item.update
          : new Uint8Array(item.update);
        await compactUpdates(noteId, snapshotBytes);
      } catch (err) {
        console.warn(`[sync] bootstrap: compact failed for ${noteId}:`, err?.message);
      }
    }

    // Collect every snapshot's noteId (the shared meta doc included) and let
    // the workspace doc create placeholder meta entries for ids it does not
    // know yet. Reconciling AFTER all snapshots are applied means notes whose
    // titled meta entries arrived with the pulled state keep their real
    // titles, and 'meta' itself can never materialize as a ghost note card.
    const bootstrapNoteIds = [];
    for (let i = 0; i < decrypted.length; i++) {
      if (!decrypted[i]?.update) continue;
      bootstrapNoteIds.push(downloadedItems[i]._noteId);
    }
    try {
      reconcileUnknownNotePlaceholders(bootstrapNoteIds);
    } catch (err) {
      console.warn('[sync] bootstrap: placeholder reconciliation failed:', err?.message);
    }
    return applied > 0;
  }

  async pull() {
    if (!this._remoteAllowed()) return { updates: [] };

    const workspaceId = await this._ensureWorkspace();
    if (!workspaceId) {
      logger.info('[sync] cloud pull: no active workspace');
      return { updates: [] };
    }

    let state;
    try {
      state = await getRemoteState(workspaceId);
    } catch (e) {
      // 404 means the workspace has no sync state yet (brand new workspace).
      // 403 means user is not a workspace member — workspace may be stale.
      if (e?.status === 404 || e?.statusCode === 404 || e?.status === 403 || e?.statusCode === 403) {
        logger.info('[sync] cloud pull: /sync/state returned', e?.status, '— resetting workspace');
        try { emit('sync:status', { status: 'workspace-reset', message: `Server returned ${e?.status}, workspace reset` }); } catch {}
        const workspaceStore = useWorkspaceStore();
        workspaceStore.activeId = null;
        this._cachedWorkspaceId = null;
        return { updates: [] };
      }
      throw e;
    }
    if (!isValidRemoteState(state)) throw malformedRemoteState();
    // Bootstrap from server snapshots if local workspace is empty
    let bootstrapped = false;
    try {
      bootstrapped = await this._bootstrapFromSnapshots(state);
      if (bootstrapped) {
        logger.info('[sync] bootstrap complete — re-fetching remote state');
        // Clear stale checkpoints for all notes so pull fetches fresh data.
        // The snapshot is authoritative; stale checkpoints from a previous
        // session would cause pull to return 0 updates even though the local
        // workspace doc was just reset.
        for (const d of state.documents || []) {
          if (d.noteId) clearServerCheckpoint(d.noteId);
        }
        state = await getRemoteState(workspaceId);
      }
    } catch (err) {
      console.warn('[sync] bootstrap failed (continuing with pull):', err?.message);
    }
    // Send stored server checkpoints so the server only returns updates we
    // haven't seen yet.  Falls back to empty checkpoint for notes without a
    // stored checkpoint (first pull after migration).
    const notes = state.documents
      .filter(d => d.noteId)
      .map(d => ({
        noteId: d.noteId,
        checkpoint: loadServerCheckpoint(d.noteId) || {},
      }));
    logger.info('[sync] pull requesting', notes.length, 'notes from server');
    const result = await remotePullUpdates(workspaceId, notes);
    const resultNoteIds = result?.notes ? Object.keys(result.notes) : [];
    const totalUpdates = resultNoteIds.reduce((sum, nid) => sum + (result.notes[nid]?.updates?.length || 0), 0);
    logger.info('[sync] pull result:', resultNoteIds.length, 'notes,', totalUpdates, 'total updates');
    const updates = [];
    let hasMore = false;
    // Hold the server's nextCheckpoint per note until the page is safely
    // decoded — saving immediately after the HTTP response would poison the
    // stored checkpoint when decrypt/validation later throws for this page
    // (all subsequent pulls would then legitimately come back empty).
    const pendingCheckpoints = new Map();
    for (const { noteId } of notes) {
      const page = result.notes?.[noteId] || { updates: [], hasMore: false };
      if (!Array.isArray(page.updates)) throw malformedRemoteUpdate();
      for (const update of page.updates || []) updates.push({ ...update, _noteId: noteId });
      hasMore ||= page.hasMore === true;
      // Server signals stale=true when the client's checkpoint is outdated
      // (e.g. from a previous session) but the server has newer data.
      // Clear the checkpoint so the next pull fetches everything.
      if (page.stale) {
        clearServerCheckpoint(noteId);
      } else if (page.updates.length > 0 && page.nextCheckpoint && Object.keys(page.nextCheckpoint).length > 0) {
        // Only advance the checkpoint when the server actually returned
        // updates.  When 0 rows match, returning an empty checkpoint
        // prevents the feedback loop where stale checkpoints poison
        // all future pulls.
        pendingCheckpoints.set(noteId, page.nextCheckpoint);
      }
    }

    const { decryptJSON, decryptBatch } = await import('../crypto.js');

    const decodedUpdates = [];
    const parseResults = [];
    for (const upd of updates) {
      const raw = atob(upd.data);
      const parsed = parseSyncFilename(upd.key);
      if (!parsed || parsed.docId !== upd._noteId ||
        typeof parsed.device !== 'string' || parsed.device.length === 0 ||
        !isNonNegativeInteger(parsed.ts) || !isNonNegativeInteger(parsed.sequence)) {
        throw malformedRemoteUpdate();
      }
      const aadSuffix = buildAadSuffix(parsed);
      parseResults.push({ raw, parsed, aadSuffix });
    }

    let decryptedPayloads;
    let sawDecryptFailed = false;
    try {
      decryptedPayloads = await decryptBatch(
        parseResults.map((r) => r.raw),
        parseResults.map((r) => r.aadSuffix)
      );
      const nullCount = decryptedPayloads.filter((p) => !p).length;
      logger.info(`[sync] decryptBatch: ${decryptedPayloads.length} items, ${nullCount} null`);

      // When SOME items fail batch decryption (e.g. encrypted with a collab
      // key instead of the sync key), retry those individually.  Items that
      // still fail are skipped — a partial sync is better than stalling
      // forever on one undecryptable update.
      if (nullCount > 0 && nullCount < decryptedPayloads.length) {
        for (let i = 0; i < decryptedPayloads.length; i++) {
          if (decryptedPayloads[i]) continue;
          try {
            decryptedPayloads[i] = await decryptJSON(parseResults[i].raw, parseResults[i].aadSuffix);
          } catch (individualErr) {
            if (individualErr?.code === 'DECRYPT_FAILED') sawDecryptFailed = true;
            decryptedPayloads[i] = null;
          }
        }
      }
    } catch (batchErr) {
      if (batchErr?.code === 'DECRYPT_FAILED') sawDecryptFailed = true;
      logger.warn('[sync] batch decrypt failed, falling back to individual:', batchErr?.message);
      decryptedPayloads = [];
      for (const r of parseResults) {
        try {
          decryptedPayloads.push(await decryptJSON(r.raw, r.aadSuffix));
        } catch (caughtError) {
          if (caughtError?.code === 'DECRYPT_FAILED') sawDecryptFailed = true;
          decryptedPayloads.push(null);
        }
      }
    }

    // Count how many items survived decryption. If NONE survived, the key
    // is genuinely locked or unavailable — surface that to the caller so
    // the engine can defer.  If SOME survived, continue with a partial sync.
    const survivingCount = decryptedPayloads.filter((p) => p !== null).length;
    if (survivingCount === 0 && decryptedPayloads.length > 0) {
      logger.warn('[sync] all decrypted payloads are null — key may be locked');
      const error = new Error('Remote update cannot be decrypted');
      error.code = sawDecryptFailed ? 'DECRYPT_FAILED' : 'unlock-required';
      throw error;
    }

    for (let i = 0; i < parseResults.length; i++) {
      const { parsed } = parseResults[i];
      const payload = decryptedPayloads[i];
      if (!payload) {
        continue;
      }
      // Use the payload's sequence if present; otherwise fall back to the envelope's
      // sequence from the filename key.  Older payloads may not include sequence in the
      // encrypted meta, but the filename always carries it.
      const payloadSequence = payload?.sequence ?? payload?.seq ?? parsed?.sequence;
      const updateBytes = toUpdateBytes(payload?.update);
      if (!payload || payload.noteId !== updates[i]._noteId || payload.device !== parsed.device ||
        !isNonNegativeInteger(payload.ts) || payload.ts !== parsed.ts ||
        !isNonNegativeInteger(payloadSequence) || !updateBytes) {
        throw malformedRemoteUpdate();
      }

      decodedUpdates.push({
        noteId: payload.noteId,
        update: updateBytes,
        device: payload.device,
        ts: payload.ts,
        sequence: payloadSequence,
      });
    }

    // Every update of this pull decoded and validated — only now persist the
    // server's checkpoints so the next pull requests updates newer than what
    // we actually applied. Any throw above leaves the stored state untouched.
    for (const [noteId, checkpoint] of pendingCheckpoints) {
      saveServerCheckpoint(noteId, checkpoint);
    }

    // NOTE: We intentionally do NOT clear checkpoints when decodedUpdates
    // is 0.  0 updates means we're caught up — the checkpoint is correct.
    // Stale checkpoints are handled server-side via the `stale` flag
    // (checked above at line 420).

    return { updates: decodedUpdates, hasMore };
  }

  async push(opts = {}) {
    if (!this._remoteAllowed()) {
      logger.info('[sync] cloud push: _remoteAllowed=false');
      return { updates: [], pushed: 0 };
    }

    const workspaceId = await this._ensureWorkspace();
    if (!workspaceId) {
      logger.info('[sync] cloud push: no active workspace');
      return { updates: [], pushed: 0 };
    }

    const force = opts?.force === true;
    if (!force && this._throttled()) {
      logger.info('[sync] cloud push: throttled');
      return { updates: [], pushed: 0, throttled: true };
    }

    const ownDeviceId = getSyncDeviceId();

    // If the push phase hasn't probed the server yet, try seeding.
    // seedCloudOnce() checks the server state and only proceeds if empty/stalled.
    if (!this._serverProbeComplete) {
      try {
        const seeded = await this.seedCloudOnce();
        if (seeded) {
          logger.info('[sync] cloud push: server seeded from local state');
        }
      } catch (err) {
        console.warn('[sync] cloud push: seedCloudOnce failed:', err?.message);
        if (err?.code === 'sync-state-invalid') throw err;
      }
    }

    // Cloud-only mode: push from in-memory buffer (no disk files)
    if (this._cloudBuffer.length > 0) {
      const { encryptJSON, encryptBatch } = await import('../crypto.js');
      const nextSequences = new Map();
      const batch = this._cloudBuffer.map((item, i) => ({
        ...item,
        sequence: i + 1,
      }));
      for (const item of batch) nextSequences.set(item.noteId, item.sequence);

      const ts = Date.now();
      let encryptedResults;
      try {
        const payloads = batch.map((item) => ({
          device: ownDeviceId,
          ts,
          sequence: item.sequence,
          noteId: item.noteId,
          update: item.update,
        }));
        const aads = batch.map((item) => `${item.noteId}-${ts}`);
        encryptedResults = await encryptBatch(payloads, aads);
      } catch (batchErr) {
        logger.warn('[sync] cloud push batch encrypt failed, falling back to individual:', batchErr?.message);
        encryptedResults = [];
        for (const item of batch) {
          encryptedResults.push(await encryptJSON({
            device: ownDeviceId,
            ts,
            sequence: item.sequence,
            noteId: item.noteId,
            update: item.update,
          }, `${item.noteId}-${ts}`));
        }
      }

      const notesMap = new Map();
      for (let i = 0; i < batch.length; i++) {
        const { noteId, sequence } = batch[i];
        if (!notesMap.has(noteId)) notesMap.set(noteId, []);
        notesMap.get(noteId).push({
          key: `${noteId}~~${ownDeviceId}~~${ts}~~${sequence}${YJS_UPDATE_EXT}`,
          data: btoa(encryptedResults[i]),
          deviceId: ownDeviceId,
          ts,
          sequence,
        });
      }

      const notes = [...notesMap.entries()].map(([noteId, updates]) => ({ noteId, updates }));
      const result = await remotePushUpdates(workspaceId, notes);
      const totalPushed = (result.accepted || 0) + (result.duplicate || 0);

      logger.info('[sync] cloud push (cloud-only) totalPushed:', totalPushed);
      this._lastPushedAt = Date.now();

      // Remove acknowledged items from the in-memory buffer
      const checkpoints = acknowledgedCheckpoints(result, [...notesMap.keys()]);
      const acknowledged = new Set();
      for (const item of batch) {
        const checkpoint = checkpoints[item.noteId];
        if (checkpoint && item.sequence <= checkpoint.sequence) acknowledged.add(item);
      }
      for (let index = this._cloudBuffer.length - 1; index >= 0; index--) {
        if (acknowledged.has(batch[index])) this._cloudBuffer.splice(index, 1);
      }
      return { updates: [], pushed: totalPushed };
    }

    // Cloud-only with empty buffer: nothing to push from memory.
    // In cloud-only mode the folder path is skipped — files there may be
    // stale (encrypted with a pre-vault-adopt key) and should not be pushed.
    if (!(await getSyncPath())) {
      return { updates: [], pushed: 0 };
    }

    // Folder sync mode: read from commits directory
    const commitsDir = await getCommitsDir();
    if (!commitsDir) {
      return { updates: [], pushed: 0 };
    }

    const allFiles = await readDir(commitsDir).catch(() => []);
    const pushedFiles = allFiles.filter((f) => f.endsWith(YJS_UPDATE_EXT) && f !== '._seeded');
    logger.info('[sync] cloud push commitsDir:', commitsDir, '| files:', pushedFiles.length, '/', allFiles.length);

    // Build file map (own device only — push everything, server deduplicates)
    const filesByNoteId = new Map();
    for (const file of pushedFiles) {
      const parsed = parseSyncFilename(file);
      if (!parsed || parsed.device !== ownDeviceId) continue;
      if (!filesByNoteId.has(parsed.docId)) filesByNoteId.set(parsed.docId, []);
      filesByNoteId.get(parsed.docId).push({ file, parsed });
    }

    let totalPushed = 0;

    // Collect all note updates for batch push
    const PUSH_VALID_NOTE_ID_RE = /^[a-zA-Z0-9_-]{1,256}$/;
    let batchNotes = [];
    for (const [noteId, files] of filesByNoteId) {
      if (!PUSH_VALID_NOTE_ID_RE.test(noteId)) {
        console.warn('[sync] cloud push: skipping note with invalid ID:', noteId.slice(0, 80));
        continue;
      }
      const noteUpdates = [];
      let batchBytes = 0;

      for (const { file, parsed } of files) {
        let raw;
        try {
          raw = await readFile(path.join(commitsDir, file));
        } catch {
          continue;
        }
        if (!raw) continue;

        const fileBytes = raw.byteLength ?? raw.length ?? 0;

        if (batchBytes + fileBytes > CLOUD_PUSH_MAX_BATCH_BYTES && noteUpdates.length > 0) {
          break;
        }

        noteUpdates.push({
          key: `${parsed.docId}~~${parsed.device}~~${parsed.ts}~~${parsed.sequence ?? 0}${YJS_UPDATE_EXT}`,
          data: btoa(typeof raw === 'string' ? raw : raw.toString()),
          deviceId: parsed.device,
          ts: parsed.ts,
          sequence: parsed.sequence ?? 0,
        });
        batchBytes += fileBytes;

        if (noteUpdates.length >= CLOUD_PUSH_MAX_FILES_PER_POST) break;
      }

      if (noteUpdates.length > 0) {
        batchNotes.push({ noteId, updates: noteUpdates });
      }
    }

    // Single batch push for all notes
    logger.info('[sync] cloud push batchNotes:', batchNotes.length, '| notes total updates:', batchNotes.reduce((s, n) => s + n.updates.length, 0));
    if (batchNotes.length > 0) {
      try {
        const result = await remotePushUpdates(workspaceId, batchNotes);
        totalPushed = (result.accepted || 0) + (result.duplicate || 0);
        logger.info('[sync] cloud push result:', JSON.stringify(result));
      } catch (e) {
        console.error('[sync] cloud push error:', e?.status, e?.message, JSON.stringify(e?.body) || '');
        throw e;
      }
    }

    logger.info('[sync] cloud push totalPushed:', totalPushed);
    this._lastPushedAt = Date.now();

    return { updates: [], pushed: totalPushed };
  }

  async seedOnce() {
    const commitsDir = await getCommitsDir();
    if (!commitsDir) return;
    await seedOnceCommits(commitsDir);
  }

  /**
   * Seed the cloud with the initial Yjs state from SQLite.
   * Called on first sync when the server has no data yet.
   * Pushes snapshots for the workspace doc and all notes.
   */
  async seedCloudOnce() {
    if (this._seedPromise) return this._seedPromise;
    this._seedPromise = this._seedCloudOptimized();
    try {
      return await this._seedPromise;
    } finally {
      this._seedPromise = null;
    }
  }

  async _seedCloudOptimized(onProgress) {
    const { emit } = await import('@tauri-apps/api/event');
    if (!this._remoteAllowed()) return false;

    const workspaceId = await this._ensureWorkspace();
    if (!workspaceId) return false;

    try {
      const state = await getRemoteState(workspaceId);
      if (!isValidRemoteState(state)) throw malformedRemoteState();
      if (!isAuthoritativelyEmpty(state) && !isStalledInit(state)) {
        this._serverProbeComplete = true;
        return false;
      }
    } catch (err) {
      if (err?.code === 'sync-state-invalid') throw err;
      // 403 = workspace not accessible, try to create a new one
      if (err?.status === 403 || err?.statusCode === 403) {
        logger.info('[sync] cloud seed: workspace not accessible, resetting');
        const workspaceStore = useWorkspaceStore();
        workspaceStore.activeId = null;
        this._cachedWorkspaceId = null;
        const newWorkspaceId = await this._ensureWorkspace();
        if (!newWorkspaceId || newWorkspaceId === workspaceId) return false;
        return this._seedCloudOptimized(onProgress);
      }
      return false;
    }

    let claim;
    try {
      claim = await claimInitialization(workspaceId);
    } catch (err) {
      if (err?.status === 409) {
        try {
          const { resetInitialization } = await import('../remote-yjs.js');
          await resetInitialization(workspaceId);
          logger.info('[sync] cloud seed: reset stuck initialization, retrying claim');
          claim = await claimInitialization(workspaceId);
        } catch (resetErr) {
          if (resetErr?.status === 409) {
            this._serverProbeComplete = true;
            return false;
          }
          throw resetErr;
        }
      } else {
        throw err;
      }
    }
    if (!claim?.token) throw new Error('cloud seed: initialization claim missing token');

    try {
    logger.info('[sync] cloud seed: claimed server initialization');
    const { encryptJSON } = await import('../crypto.js');
    const ownDeviceId = getSyncDeviceId();
    const ts = Date.now();
    const snapshots = [];
    const noteIds = [];

    const workspaceDoc = getWorkspaceDoc();
    const wsState = Y.encodeStateAsUpdate(workspaceDoc);
    if (wsState.byteLength > 0) {
      const encrypted = await encryptJSON({
        device: ownDeviceId,
        ts,
        sequence: 0,
        noteId: META_DOC_ID,
        update: wsState,
      }, `${META_DOC_ID}-${ts}`);
      snapshots.push({ noteId: META_DOC_ID, data: btoa(encrypted), noteTs: ts });
      noteIds.push(META_DOC_ID);
    }

    const notesMap = workspaceDoc.getMap('notes');
    const VALID_NOTE_ID_RE = /^[a-zA-Z0-9_-]{1,256}$/;
    const allNoteIds = Array.from(notesMap.keys()).filter(
      (id) => typeof id === 'string' && id.trim().length > 0 && id !== 'undefined'
        && VALID_NOTE_ID_RE.test(id)
    );

    for (const noteId of allNoteIds) {
      try {
        const doc = new Y.Doc();
        try {
          let loaded = false;
          try {
            const snapshot = await getSnapshot(noteId);
            if (snapshot && snapshot.length > 0) {
              Y.applyUpdate(doc, toUint8Array(snapshot));
              loaded = true;
            }
          } catch {}
          if (!loaded) {
            const updates = await getUpdates(noteId);
            applyUpdatesToDoc(doc, updates);
          }
          const state = Y.encodeStateAsUpdate(doc);
          if (state.byteLength > 0) {
            const noteTs = ts + snapshots.length;
            const encrypted = await encryptJSON({
              device: ownDeviceId,
              ts: noteTs,
              sequence: 0,
              noteId,
              update: state,
            }, `${noteId}-${noteTs}`);
            snapshots.push({ noteId, data: btoa(encrypted), noteTs });
            noteIds.push(noteId);
          }
        } finally {
          doc.destroy();
        }
      } catch (err) {
        console.warn('[sync] cloud seed: skipping note', noteId, err);
      }
    }

    if (snapshots.length === 0) {
      throw new Error('cloud seed: nothing to push');
    }

    logger.info(`[sync] cloud seed: uploading ${snapshots.length} snapshots via presigned URLs`);
    if (onProgress) onProgress({ phase: 'presign', uploaded: 0, total: snapshots.length });
    try { emit('sync:progress', { phase: 'presign', processed: 0, total: snapshots.length }); } catch {}

    const { urls, generation } = await getSnapshotUrls(workspaceId, claim.token, noteIds);
    if (!urls || Object.keys(urls).length !== snapshots.length) {
      throw new Error('cloud seed: presign incomplete');
    }

    const CONCURRENT = 4;
    const documents = [];

    for (let i = 0; i < snapshots.length; i += CONCURRENT) {
      const batch = snapshots.slice(i, i + CONCURRENT);
      await Promise.all(batch.map(async ({ noteId, data, noteTs: snapNoteTs }) => {
        const { url, key } = urls[noteId];
        const bytes = Uint8Array.from(atob(data), c => c.charCodeAt(0));
        const response = await fetch(url, {
          method: 'PUT',
          body: bytes,
          headers: { 'Content-Type': 'application/octet-stream' },
        });
        if (!response.ok) throw new Error(`snapshot upload failed: ${response.status}`);
        documents.push({
          noteId,
          snapshotGeneration: generation,
          snapshotKey: key,
          checkpointTs: 0,
          checkpointSequence: 0,
          snapshotTs: snapNoteTs,
        });
      }));
      logger.info(`[sync] cloud seed: uploaded ${Math.min(i + CONCURRENT, snapshots.length)}/${snapshots.length} snapshots`);
      if (onProgress) onProgress({ phase: 'snapshots', uploaded: Math.min(i + CONCURRENT, snapshots.length), total: snapshots.length });
      try { emit('sync:progress', { phase: 'snapshots', processed: Math.min(i + CONCURRENT, snapshots.length), total: snapshots.length }); } catch {}
    }

    logger.info('[sync] cloud seed: seeding assets');
    if (onProgress) onProgress({ phase: 'assets', uploaded: 0, total: 0 });

    const requiredAssetKeys = [];
    const { getAppDirectory } = await import('@/lib/native/app');
    const appDir = await getAppDirectory();
    if (appDir) {
      const assetKeys = [];
      const assetFilesMap = new Map();
      for (const assetType of ASSET_TYPES) {
        const localBase = `${appDir}/${assetType}`;
        const noteDirIds = await readDir(localBase).catch(() => []);
        for (const nid of noteDirIds) {
          const noteDir = `${localBase}/${nid}`;
          const files = await readDir(noteDir).catch(() => []);
          for (const file of files) {
            const flatKey = encodeAssetKey(assetType, nid, file);
            assetKeys.push(flatKey);
            assetFilesMap.set(flatKey, { key: flatKey, localPath: `${noteDir}/${file}` });
          }
        }
      }

      if (assetKeys.length > 0) {
        requiredAssetKeys.push(...assetKeys);
        let toUploadKeys = assetKeys;
        try {
          const remote = new Set(await listRemoteAssets());
          const missing = assetKeys.filter((k) => !remote.has(k));
          logger.info(`[sync] cloud seed: ${assetKeys.length} local assets, ${assetKeys.length - missing.length} already on server, ${missing.length} to upload`);
          if (missing.length < assetKeys.length) toUploadKeys = missing;
        } catch (err) {
          console.warn('[sync] cloud seed: could not list remote assets, uploading all:', err?.message);
        }
        if (onProgress) onProgress({ phase: 'assets', uploaded: 0, total: toUploadKeys.length });
        try { emit('sync:progress', { phase: 'assets', processed: 0, total: toUploadKeys.length }); } catch {}

        const assetEntries = [];
        for (const assetKey of toUploadKeys) {
          const file = assetFilesMap.get(assetKey);
          if (!file) continue;
          try {
            const bytes = await readFileBinaryBytes(file.localPath);
            if (bytes && bytes.byteLength > 0) {
              assetEntries.push({ key: assetKey, data: bytes, size: bytes.byteLength });
            }
          } catch (err) {
            console.warn('[sync] cloud seed: skipping asset', assetKey, err?.message);
          }
        }

        // Build batches capped at SEED_BATCH_MAX_ITEMS items AND 10MB, matching
        // the backend /seed-batch contract (50 items / 100MB body limit).
        assetEntries.sort((a, b) => a.size - b.size);

        const batches = buildSeedAssetBatches(assetEntries);

        logger.info(`[sync] cloud seed: ${assetEntries.length} assets in ${batches.length} batches`);

        // Upload batches
        let assetsUploaded = 0;
        for (let bi = 0; bi < batches.length; bi++) {
          const batch = batches[bi];
          try {
            const result = await seedBatchUploadAssets(batch);
            assetsUploaded += (result.uploaded || 0) + (result.skipped || 0);
            logger.info(`[sync] cloud seed: asset batch ${bi + 1}/${batches.length} done — uploaded: ${result.uploaded || 0}, skipped: ${result.skipped || 0} (${assetsUploaded}/${toUploadKeys.length} total)`);
          } catch (err) {
            logger.warn(`[sync] cloud seed: batch ${bi + 1}/${batches.length} failed:`, err?.message || err);
          }
          if (onProgress) onProgress({ phase: 'assets', uploaded: assetsUploaded, total: toUploadKeys.length });
          try { emit('sync:progress', { phase: 'assets', processed: assetsUploaded, total: toUploadKeys.length }); } catch {}
        }
      }
    }

    logger.info(`[sync] cloud seed: ${documents.length} snapshots uploaded, proceeding to asset upload`);
    logger.info('[sync] cloud seed: completing initialization');
    if (onProgress) onProgress({ phase: 'finalizing', uploaded: snapshots.length, total: snapshots.length });
    try { emit('sync:progress', { phase: 'finalizing', processed: snapshots.length, total: snapshots.length }); } catch {}

    await completeInitialization(workspaceId, claim.token, generation, documents, requiredAssetKeys);
    this._serverProbeComplete = true;
    this._lastPushedAt = Date.now();

    // Publish vault key params so other devices can join the vault
    try {
      const { publishCloudKeyParams } = await import('../vault-key-params.js');
      await publishCloudKeyParams();
      logger.info('[sync] cloud seed: vault key params published');
    } catch (err) {
      console.warn('[sync] cloud seed: vault key params publish failed:', err?.message);
    }

    logger.info('[sync] cloud seed: completed successfully');
    if (onProgress) onProgress({ phase: 'done', uploaded: snapshots.length, total: snapshots.length });
    try { emit('sync:progress', { phase: 'done', processed: snapshots.length, total: snapshots.length }); } catch {}

    return snapshots.length > 0;
  } catch (err) {
    console.error('[sync] cloud seed: optimized seed failed:', err?.status, err?.message);
    return false;
  }
  }

  async compact() {
    // no-op — server handles compaction
  }

  async syncAssets(onProgress) {
    if (!this._remoteAllowed()) return;

    const workspaceId = await this._ensureWorkspace();
    if (!workspaceId) return;
    try {
      const state = await getRemoteState(workspaceId);
      if (state?.status !== 'initialized') {
        logger.info(`[sync] syncAssets: workspace status ${state?.status ?? 'unknown'} — skipping asset sync (seed handles assets)`);
        return;
      }
    } catch (e) {
      if (e?.status === 404 || e?.statusCode === 404 || e?.status === 403 || e?.statusCode === 403) {
        logger.info('[sync] syncAssets: workspace not accessible — skipping asset sync');
        return;
      }
      throw e;
    }

    const { getAppDirectory } = await import('@/lib/native/app');
    const appDir = await getAppDirectory();
    if (!appDir) {
      logger.info('[sync] syncAssets: no appDir');
      return;
    }

    logger.info('[sync] syncAssets appDir:', appDir);

    const deletedAssets = yMapToObj(getWorkspaceDoc().getMap('deletedAssets'));
    let deletedAssetsDirty = false;

    const remoteKeys = await listRemoteAssets();
    const remoteMap = new Map();
    for (const key of remoteKeys) {
      const decoded = decodeAssetKey(key);
      if (decoded) remoteMap.set(key, decoded);
    }

    const ops = [];

    for (const assetType of ASSET_TYPES) {
      const localBase = path.join(appDir, assetType);
      await ensureDir(localBase).catch(() => {});

      const localNoteIds = await readDir(localBase)
        .then((e) => e.filter((n) => n && !n.startsWith('.')))
        .catch((e) => { logger.info('[sync] syncAssets readDir failed:', assetType, e?.message); return []; });

      logger.info('[sync] syncAssets', assetType, 'noteIds:', localNoteIds.length);

      for (const noteId of localNoteIds) {
        const localNoteDir = path.join(localBase, noteId);
        const localFiles = await readDir(localNoteDir)
          .then((e) => e.filter((f) => f && !f.startsWith('.')))
          .catch(() => []);

        for (const file of localFiles) {
          const assetKey = `${assetType}/${noteId}/${file}`;
          const flatKey = encodeAssetKey(assetType, noteId, file);

          if (deletedAssets[assetKey]) {
            ops.push({ type: 'remove-local', src: path.join(localNoteDir, file) });
            continue;
          }

          if (!remoteMap.has(flatKey)) {
            ops.push({
              type: 'upload',
              flatKey,
              src: path.join(localNoteDir, file),
            });
          }
        }
      }

      const remoteForType = [...remoteMap.values()].filter((d) => d.type === assetType);
      for (const decoded of remoteForType) {
        const localNoteDir = path.join(appDir, assetType, decoded.noteId);
        const localFile = localAssetName(decoded.filename);
        const localPath = path.join(localNoteDir, localFile);

        const exists = await pathExists(localPath);
        if (!exists) {
          ops.push({
            type: 'download',
            flatKey: encodeAssetKey(assetType, decoded.noteId, decoded.filename),
            dest: path.join(localNoteDir, localAssetName(decoded.filename)),
          });
        }
      }
    }

    const total = ops.length;
    logger.info('[sync] syncAssets total ops:', total, '| remote:', remoteKeys.length);
    if (total === 0) return;
    let processed = 0;

    onProgress?.({ phase: 'assets-scan', processed: 0, total });

    const BATCH_MAX_BYTES = 10 * 1024 * 1024;
    const BATCH_MAX_ITEMS = 20;
    const BATCH_DELAY_MS = 500;
    const INDIVIDUAL_DELAY_MS = 1500;

    const uploads = ops.filter((op) => op.type === 'upload');
    const others = ops.filter((op) => op.type !== 'upload');

    const batches = [];
    let currentBatch = [];
    let currentBytes = 0;
    for (const op of uploads) {
      try {
        const data = await readFileBinaryBytes(op.src);
        if (!data || data.byteLength === 0) {
          console.warn('[sync] asset read empty:', op.flatKey);
          continue;
        }
        const itemBytes = data.byteLength;
        if (itemBytes > BATCH_MAX_BYTES) {
          if (currentBatch.length > 0) {
            batches.push(currentBatch);
            currentBatch = [];
            currentBytes = 0;
          }
          batches.push([{ key: op.flatKey, data }]);
          console.warn('[sync] oversized asset, solo batch:', op.flatKey, `${(itemBytes / 1048576).toFixed(1)}MB`);
          continue;
        }
        if (currentBatch.length > 0
          && (currentBytes + itemBytes > BATCH_MAX_BYTES || currentBatch.length >= BATCH_MAX_ITEMS)) {
          batches.push(currentBatch);
          currentBatch = [];
          currentBytes = 0;
        }
        currentBatch.push({ key: op.flatKey, data });
        currentBytes += itemBytes;
      } catch (err) {
        console.warn('[sync] asset read failed:', op.flatKey, err?.message);
      }
    }
    if (currentBatch.length > 0) batches.push(currentBatch);

    let batchNum = 0;
    for (const batch of batches) {
      batchNum++;
      let result;
      try {
        result = await batchUploadAssets(batch);
      } catch (err) {
        const status = err?.status || err?.statusCode;
        if (status === 429) {
          await new Promise((r) => setTimeout(r, 5000));
          try {
            result = await batchUploadAssets(batch);
          } catch (retryErr) {
            console.warn('[sync] batch retry also failed:', retryErr?.message);
          }
        } else if (status === 413 || err?.message?.includes('too large')) {
          if (batch.length > 1) {
            const half = Math.ceil(batch.length / 2);
            batches.splice(batchNum, 0, batch.slice(half));
            batch.length = half;
            batchNum--;
            continue;
          }
          console.warn('[sync] single asset too large, skipping:', batch[0]?.key);
        } else {
          console.warn('[sync] batch upload failed:', err?.message || status);
        }
      }

      if (result) {
        const uploaded = result?.uploaded ?? 0;
        const skipped = result?.skipped ?? 0;
        logger.info(`[sync] batch ${batchNum}/${batches.length}: uploaded=${uploaded} skipped=${skipped} items=${batch.length}`);
      }

      if (!result) {
        // Request failed entirely — fall back to individual
        logger.info(`[sync] batch request failed, falling back to individual for ${batch.length} items`);
        for (const item of batch) {
          for (let attempt = 0; attempt < 3; attempt++) {
            try {
              await uploadAsset(item.key, item.data);
              break;
            } catch (e) {
              const s = e?.status || e?.statusCode;
              if (s === 429) {
                const waitMs = INDIVIDUAL_DELAY_MS * Math.pow(2, attempt);
                console.warn('[sync] individual 429, waiting', waitMs, 'ms:', item.key);
                await new Promise((r) => setTimeout(r, waitMs));
                continue;
              }
              console.warn('[sync] individual upload failed:', item.key, e?.message || s);
              break;
            }
          }
          await new Promise((r) => setTimeout(r, INDIVIDUAL_DELAY_MS));
        }
      } else if ((result?.uploaded ?? 0) === 0 && (result?.skipped ?? 0) === 0) {
        // No uploads and no skips means errors — fall back to individual
        const errorItems = result?.results?.filter((r) => r.status === 'error') ?? [];
        logger.info(`[sync] batch had ${errorItems.length} errors, falling back to individual for ${batch.length} items`);
        for (const item of batch) {
          try {
            await uploadAsset(item.key, item.data);
          } catch (e) {
            console.warn('[sync] individual upload failed:', item.key, e?.message);
          }
          await new Promise((r) => setTimeout(r, INDIVIDUAL_DELAY_MS));
        }
      }

      processed += batch.length;
      onProgress?.({ phase: 'assets', processed, total });
      if (batchNum < batches.length) {
        await new Promise((r) => setTimeout(r, BATCH_DELAY_MS));
      }
    }

    const DOWNLOAD_DELAY_MS = 1000;
    const DOWNLOAD_BACKOFF_THRESHOLD = 5;
    const downloads = others.filter((op) => op.type === 'download');
    const removes = others.filter((op) => op.type === 'remove-local');

    // Batch-download via presigned GET URLs (no server proxy, no rate limits)
    if (downloads.length > 0) {
      const PRESIGN_CHUNK = 200;
      const allUrls = [];
      const downloadMap = new Map();
      for (const op of downloads) {
        downloadMap.set(op.flatKey, op);
      }

      const keys = downloads.map((op) => op.flatKey);
      for (let i = 0; i < keys.length; i += PRESIGN_CHUNK) {
        const chunk = keys.slice(i, i + PRESIGN_CHUNK);
        try {
          const urls = await presignGetBatch(chunk);
          allUrls.push(...urls);
        } catch (err) {
          console.warn('[sync] presign-get-batch failed:', err?.message);
        }
      }

      logger.info(`[sync] batch download: ${allUrls.length}/${keys.length} presigned URLs`);

      const presignedKeys = new Set(allUrls.map((u) => u.assetKey));

      const CONCURRENT = 3;
      const RETRY_DELAYS = [2000, 4000, 8000];
      for (let i = 0; i < allUrls.length; i += CONCURRENT) {
        const batch = allUrls.slice(i, i + CONCURRENT);
        await Promise.all(batch.map(async ({ assetKey, url }) => {
          const op = downloadMap.get(assetKey);
          if (!op) return;
          const failures = this._failedDownloads.get(assetKey) || 0;
          if (failures >= DOWNLOAD_BACKOFF_THRESHOLD) {
            logger.info('[sync] skipping repeatedly failed download:', assetKey);
            return;
          }
          for (let attempt = 0; attempt <= RETRY_DELAYS.length; attempt++) {
            try {
              await ensureDir(path.dirname(op.dest)).catch(() => {});
              const bytesWritten = await downloadUrl(url, op.dest);
              if (!bytesWritten || bytesWritten === 0) {
                this._failedDownloads.set(assetKey, failures + 1);
                return;
              }
              this._failedDownloads.delete(assetKey);
              return;
            } catch (err) {
              const msg = err?.message || '';
              if (msg.includes('status 429') && attempt < RETRY_DELAYS.length) {
                const waitMs = RETRY_DELAYS[attempt];
                console.warn('[sync] download 429, retrying in', waitMs, 'ms:', assetKey);
                await new Promise((r) => setTimeout(r, waitMs));
                continue;
              }
              if (attempt < RETRY_DELAYS.length) {
                await new Promise((r) => setTimeout(r, RETRY_DELAYS[attempt]));
                continue;
              }
              console.warn('[sync] streaming download failed:', assetKey, msg);
              this._failedDownloads.set(assetKey, failures + 1);
              return;
            }
          }
        }));
        processed += batch.length;
        onProgress?.({ phase: 'assets', processed, total });
        if (i + CONCURRENT < allUrls.length) {
          await new Promise((r) => setTimeout(r, DOWNLOAD_DELAY_MS));
        }
      }

      // Fallback for any keys that didn't get presigned URLs
      for (const op of downloads) {
        if (!presignedKeys.has(op.flatKey)) {
          const failures = this._failedDownloads.get(op.flatKey) || 0;
          if (failures >= DOWNLOAD_BACKOFF_THRESHOLD) continue;
          try {
            const data = await downloadAsset(op.flatKey);
            if (data) {
              await ensureDir(path.dirname(op.dest)).catch(() => {});
              await writeFs(op.dest, data);
              this._failedDownloads.delete(op.flatKey);
            } else {
              this._failedDownloads.set(op.flatKey, failures + 1);
            }
          } catch (err) {
            console.warn('[sync] fallback download failed:', op.flatKey, err?.message);
            this._failedDownloads.set(op.flatKey, failures + 1);
          }
          await new Promise((r) => setTimeout(r, DOWNLOAD_DELAY_MS));
          processed++;
          onProgress?.({ phase: 'assets', processed, total });
        }
      }
    }

    for (const op of removes) {
      try {
        const { removePath } = await import('@/lib/native/fs');
        await removePath(op.src).catch(() => {});
      } catch (err) {
        console.warn('[sync] asset op failed:', op.type, op.flatKey, err?.message);
      }
      processed++;
      onProgress?.({ phase: 'assets', processed, total });
    }

    onProgress?.({ phase: 'assets', processed: total, total });

    if (deletedAssetsDirty) {
      mergeIntoMap('deletedAssets', deletedAssets);
    }
  }

  _remoteAllowed() {
    return this._readiness?.syncAllowed ?? false;
  }

  _throttled() {
    return Date.now() - this._lastPushedAt < CLOUD_PUSH_MIN_INTERVAL_MS;
  }
}
