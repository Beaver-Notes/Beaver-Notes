import { Transport } from './transport.js';
import { normalizeSyncTransport } from '@/lib/api/types.js';
import {
  pushUpdates as remotePushUpdates,
  pullUpdates as remotePullUpdates,
  getRemoteState,
  claimInitialization,
  completeInitialization,
  getSnapshotUrls,
  createWorkspace,
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
import { writeInitialSnapshots } from './seed.js';
import { YJS_UPDATE_EXT, ASSET_TYPES } from '../constants.js';
import { readDir, readFile, readFileBinaryBytes, writeFile as writeFs, ensureDir, pathExists, downloadUrl } from '@/lib/native/fs';
import { path } from '@/lib/tauri-bridge';
import { localAssetName } from '../crypto.js';
import { yMapToObj } from '@/lib/yjs/helpers.js';
import { getWorkspaceDoc } from '@/lib/yjs/meta-doc.js';
import { mergeIntoMap } from '@/lib/yjs/workspace-doc';
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

function isNonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0;
}

function malformedRemoteUpdate() {
  const error = new Error('Remote update payload is malformed');
  error.code = 'unlock-required';
  return error;
}

function toUpdateBytes(value) {
  if (value instanceof Uint8Array) return new Uint8Array(value);
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (Array.isArray(value) && value.every((byte) => isNonNegativeInteger(byte) && byte <= 255)) {
    return new Uint8Array(value);
  }
  return null;
}

function validateCheckpoint(checkpoint) {
  if (checkpoint?.deviceId) {
    return typeof checkpoint.deviceId === 'string' && checkpoint.deviceId.length > 0 &&
      isNonNegativeInteger(checkpoint.ts) && isNonNegativeInteger(checkpoint.sequence);
  }
  return checkpoint && typeof checkpoint === 'object' && Object.entries(checkpoint).every(([deviceId, value]) =>
    typeof deviceId === 'string' && deviceId.length > 0 && value &&
    isNonNegativeInteger(value.ts) && isNonNegativeInteger(value.sequence));
}

function checkpointMap(checkpoint) {
  return checkpoint?.deviceId
    ? { [checkpoint.deviceId]: { ts: checkpoint.ts, sequence: checkpoint.sequence } }
    : checkpoint;
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
  constructor({ passphraseProvider, getTransportSetting, getAccountState }) {
    super();
    this.passphraseProvider = passphraseProvider;
    this.getTransportSetting = getTransportSetting;
    this.getAccountState = getAccountState;
    this._lastPushedAt = 0;
    this._cloudBuffer = [];
    this._serverProbeComplete = false;
    this._failedDownloads = new Map();
    this._seedPromise = null;
  }

  getCloudBuffer() {
    return this._cloudBuffer;
  }

  _getWorkspaceId() {
    const workspaceStore = useWorkspaceStore();
    return workspaceStore.activeId;
  }

  async _ensureWorkspace() {
    const workspaceStore = useWorkspaceStore();
    if (workspaceStore.activeId) return workspaceStore.activeId;
    // Check cached value to avoid re-fetching every cycle
    if (this._cachedWorkspaceId) return this._cachedWorkspaceId;
    try {
      const { useAccountStore } = await import('@/store/account');
      const accountStore = useAccountStore();
      if (!accountStore.isAuthenticated) return null;
      const { getApiClient } = await import('@/lib/api/client');
      const client = getApiClient({ baseUrl: accountStore.serverUrl });
      const raw = await client.get('/workspaces');
      const list = raw?.workspaces ?? [];
      if (list.length > 0) {
        workspaceStore.workspaces = list.map((w) => ({
          id: w.id,
          name: w.name,
          role: w.role,
          ownerId: w.ownerId,
          storageUsedBytes: w.storageUsedBytes,
          createdAt: w.createdAt,
        }));
        workspaceStore.activeId = workspaceStore.activeId || list[0].id;
        this._cachedWorkspaceId = list[0].id;
      } else {
        // No workspaces — auto-create one
        logger.info('[sync] cloud: no workspaces found, creating default workspace');
        const profile = accountStore.profile;
        const orgId = accountStore.activeOrgId || profile?.organizationId;
        if (!orgId) {
          console.warn('[sync] cloud: no orgId available, cannot create workspace');
          return null;
        }
        try {
          const created = await createWorkspace('Default', orgId);
          if (created?.id) {
            workspaceStore.activeId = created.id;
            this._cachedWorkspaceId = created.id;
            logger.info('[sync] cloud: created workspace', created.id);
          }
        } catch (createErr) {
          console.warn('[sync] cloud: failed to create workspace:', createErr?.message);
        }
      }
    } catch (err) {
      console.warn('[sync] cloud: direct workspace fetch failed:', err?.status, err?.message);
    }
    return workspaceStore.activeId || this._cachedWorkspaceId;
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
    const needsBootstrap = docs.filter(
      (d) => !localSnapshots?.[d.noteId] || localSnapshots[d.noteId].length === 0
    );

    if (needsBootstrap.length === 0) return false;
    logger.info(`[sync] bootstrap: ${needsBootstrap.length} notes need snapshot download`);

    const noteIdsForDownload = needsBootstrap.map((d) => d.noteId);
    const BATCH_SIZE = 50;
    const allUrls = {};
    let generation = 0;

    for (let i = 0; i < noteIdsForDownload.length; i += BATCH_SIZE) {
      const batch = noteIdsForDownload.slice(i, i + BATCH_SIZE);
      try {
        const result = await getSnapshotDownloadUrls(workspaceId, batch);
        if (result?.urls) Object.assign(allUrls, result.urls);
        if (result?.generation) generation = result.generation;
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

    for (let i = 0; i < urlEntries.length; i++) {
      const [noteId, { url, snapshotTs }] = urlEntries[i];
      try {
        const response = await fetch(url);
        if (!response.ok) {
          console.warn(`[sync] bootstrap: download failed for ${noteId}: ${response.status}`);
          continue;
        }
        const blob = await response.blob();
        const arrayBuf = await blob.arrayBuffer();
        const envelope = new TextDecoder().decode(arrayBuf);
        downloadedItems.push({ _noteId: noteId, data: envelope, key: `bootstrap-${noteId}`, snapshotTs });
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

    const aadSuffixes = downloadedItems.map(
      (item) => `${item._noteId}-${item.snapshotTs}`
    );

    const decrypted = await decryptBatch(
      downloadedItems.map((item) => item.data),
      aadSuffixes
    );
    const { appendUpdate } = await import('@/lib/native/yjs.js');
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
        applied++;
      } catch (err) {
        console.warn(`[sync] bootstrap: apply failed for ${downloadedItems[i]?._noteId}:`, err?.message);
      }
    }

    logger.info(`[sync] bootstrap: applied ${applied}/${downloadedItems.length} snapshots`);
    return applied > 0;
  }

  async pull(cursors) {
    if (!this._remoteAllowed()) return { updates: [], cursorsDelta: {} };

    const workspaceId = await this._ensureWorkspace();
    if (!workspaceId) {
      logger.info('[sync] cloud pull: no active workspace');
      return { updates: [], cursorsDelta: {} };
    }

    const noteCursors = Object.fromEntries(Object.entries(cursors[workspaceId] || {}));
    let state;
    try {
      state = await getRemoteState(workspaceId);
    } catch (e) {
      // 404 means the workspace has no sync state yet (brand new workspace).
      // 403 means user is not a workspace member — workspace may be stale.
      // In both cases, reset and let the push phase try to create/fetch a valid workspace.
      if (e?.status === 404 || e?.statusCode === 404 || e?.status === 403 || e?.statusCode === 403) {
        logger.info('[sync] cloud pull: /sync/state returned', e?.status, '— resetting workspace');
        const workspaceStore = useWorkspaceStore();
        workspaceStore.activeId = null;
        this._cachedWorkspaceId = null;
        return { updates: [], cursorsDelta: {} };
      }
      throw e;
    }
    if (!isValidRemoteState(state)) throw malformedRemoteState();
    // If the server is empty or has a stalled init, allow the push phase to re-seed.
    if (isAuthoritativelyEmpty(state) || isStalledInit(state)) {
      this._serverProbeComplete = false;
    }
    // Bootstrap from server snapshots if local workspace is empty
    let bootstrapped = false;
    try {
      bootstrapped = await this._bootstrapFromSnapshots(state);
      if (bootstrapped) {
        logger.info('[sync] bootstrap complete — re-fetching remote state');
        state = await getRemoteState(workspaceId);
      }
    } catch (err) {
      console.warn('[sync] bootstrap failed (continuing with pull):', err?.message);
    }
    // Initialize cursors from server checkpoint for notes that don't have local cursors yet.
    // This prevents "cursor mismatch" when server only has snapshots (checkpointTs/Sequence = 0)
    // and client sends empty checkpoint {}.
    for (const document of state.documents) {
      if (!document.noteId) continue;
      if (!noteCursors[document.noteId]) {
        const deviceId = getSyncDeviceId();
        const checkpointTs = document.checkpointTs ?? 0;
        const checkpointSequence = document.checkpointSequence ?? 0;
        noteCursors[document.noteId] = {
          [deviceId]: { ts: checkpointTs, sequence: checkpointSequence },
        };
        logger.info('[sync][debug] initialized cursor from server state', {
          noteId: document.noteId,
          checkpointTs,
          checkpointSequence,
        });
      }
    }

    const notes = Object.entries(noteCursors).map(([noteId, noteCursor]) => ({
      noteId,
      checkpoint: noteCursor || {},
    }));
    // Track which notes had non-empty cursors BEFORE this pull (not just initialized from server state)
    // to detect actual mismatches. Notes initialized from server state at 0/0 are expected to have
    // zero updates on first pull after bootstrap.
    const notesWithPreExistingCursor = new Set();
    for (const [noteId, noteCursor] of Object.entries(noteCursors)) {
      const hasCursor = noteCursor && Object.keys(noteCursor).length > 0;
      if (hasCursor) {
        // Check if this cursor was just initialized from server state at 0/0
        const deviceId = getSyncDeviceId();
        const cursorForDevice = noteCursor[deviceId];
        const isFreshlyInitializedFromServer = cursorForDevice && cursorForDevice.ts === 0 && cursorForDevice.sequence === 0;
        if (!isFreshlyInitializedFromServer) {
          notesWithPreExistingCursor.add(noteId);
        }
      }
    }
    logger.info('[sync][debug] pull requesting', notes.length, 'notes from server');
    const result = await remotePullUpdates(workspaceId, notes);
    const resultNoteIds = result?.notes ? Object.keys(result.notes) : [];
    const totalUpdates = resultNoteIds.reduce((sum, nid) => sum + (result.notes[nid]?.updates?.length || 0), 0);
    logger.info('[sync][debug] pull result:', resultNoteIds.length, 'notes,', totalUpdates, 'total updates');
    // Only warn for notes that had a pre-existing local cursor (not just initialized from server at 0/0)
    // but got zero updates. This avoids false positives when server only has snapshots (checkpoint 0/0)
    // and client correctly initializes cursor to 0/0 — zero updates is expected in that case.
    if (resultNoteIds.length > 0 && totalUpdates === 0) {
      const mismatchedNotes = resultNoteIds.filter((nid) => notesWithPreExistingCursor.has(nid));
      if (mismatchedNotes.length > 0) {
        logger.warn('[sync][debug] server returned notes but zero updates for notes with pre-existing local cursor — possible cursor mismatch:', mismatchedNotes);
      } else {
        logger.info('[sync][debug] server returned notes with zero updates (expected for snapshot-only notes)');
      }
    }
    const updates = [];
    const cursorsDelta = {};
    let hasMore = false;
    for (const [noteId] of Object.entries(noteCursors)) {
      const page = result.notes?.[noteId] || { updates: [], hasMore: false };
      if (!Array.isArray(page.updates)) throw malformedRemoteUpdate();
      for (const update of page.updates || []) updates.push({ ...update, _noteId: noteId });
      if (page.nextCheckpoint) {
        const checkpoint = page.nextCheckpoint;
        if (!validateCheckpoint(checkpoint)) throw malformedRemoteUpdate();
        cursorsDelta[workspaceId] ||= {};
        cursorsDelta[workspaceId][noteId] = checkpointMap(checkpoint);
      }
      hasMore ||= page.hasMore === true;
    }

    const { decryptJSON, decryptBatch } = await import('../crypto.js');

    const decodedUpdates = [];
    const parseResults = [];
    for (const upd of updates) {
      const raw = atob(upd.data);
      const parsed = parseSyncFilename(upd.key);
      if (!parsed || parsed.docId !== upd._noteId ||
        typeof parsed.device !== 'string' || parsed.device.length === 0 ||
        !isNonNegativeInteger(parsed.ts) || !isNonNegativeInteger(parsed.seq)) {
        throw malformedRemoteUpdate();
      }
      const aadSuffix = parsed?.isSnapshot
        ? `${parsed.docId}-snapshot-${parsed.ts}`
        : `${parsed.docId}-${parsed.ts}`;
      parseResults.push({ raw, parsed, aadSuffix });
    }

    let decryptedPayloads;
    try {
      decryptedPayloads = await decryptBatch(
        parseResults.map((r) => r.raw),
        parseResults.map((r) => r.aadSuffix)
      );
      const nullCount = decryptedPayloads.filter((p) => !p).length;
      logger.info(`[sync][debug] decryptBatch returned ${decryptedPayloads.length} items, ${nullCount} null`);
      if (decryptedPayloads[0]) {
        const p = decryptedPayloads[0];
        logger.warn('[sync][debug] first decrypted payload shape:', JSON.stringify({
          keys: Object.keys(p),
          noteId: p.noteId,
          device: p.device,
          ts: p.ts,
          seq: p.sequence ?? p.seq,
          updateType: typeof p.update,
          updateIsArray: Array.isArray(p.update),
          updateConstructor: p.update?.constructor?.name,
          updateLength: Array.isArray(p.update) ? p.update.length : (p.update instanceof Uint8Array ? p.update.byteLength : undefined),
        }));
      }
    } catch (batchErr) {
      logger.warn('[sync] batch decrypt failed, falling back to individual:', batchErr?.message);
      decryptedPayloads = [];
      for (const r of parseResults) {
        try {
          decryptedPayloads.push(await decryptJSON(r.raw, r.aadSuffix));
        } catch (caughtError) {
          logger.warn('[sync][debug] individual decryptJSON failed:', caughtError?.code, caughtError?.message);
          // Preserve the real cause: KEY_LOCKED means the key is loaded but
          // locked; DECRYPT_FAILED means the local key doesn't match the sync
          // data. Collapsing both to 'unlock-required' hid the mismatch and
          // made the engine defer forever with a misleading message.
          const error = new Error(caughtError?.message || 'Remote update cannot be decrypted');
          error.code = caughtError?.code || 'unlock-required';
          throw error;
        }
      }
    }

    for (let i = 0; i < parseResults.length; i++) {
      const { parsed } = parseResults[i];
      const payload = decryptedPayloads[i];
      if (!payload) {
        logger.warn(`[sync][debug] decryptedPayloads[${i}] is null — throwing unlock-required. Envelope version:`, parseResults[i]?.parsed?.v, 'noteId:', parsed?.docId);
        const error = new Error('Remote update cannot be decrypted');
        error.code = 'unlock-required';
        throw error;
      }
      // Use the payload's seq if present; otherwise fall back to the envelope's
      // seq from the filename key.  Older payloads may not include seq in the
      // encrypted meta, but the filename always carries it.
      const payloadSequence = payload?.sequence ?? payload?.seq ?? parsed?.seq;
      const updateBytes = toUpdateBytes(payload?.update);
      if (!payload || payload.noteId !== updates[i]._noteId || payload.device !== parsed.device ||
        !isNonNegativeInteger(payload.ts) || payload.ts !== parsed.ts ||
        !isNonNegativeInteger(payloadSequence) || !updateBytes) {
        const reasons = [];
        if (!payload) reasons.push('null_payload');
        if (payload?.noteId !== updates[i]?._noteId) reasons.push(`noteId_mismatch:${payload?.noteId}!=${updates[i]?._noteId}`);
        if (payload?.device !== parsed?.device) reasons.push(`device_mismatch:${payload?.device}!=${parsed?.device}`);
        if (!isNonNegativeInteger(payload?.ts)) reasons.push(`ts_not_int:${payload?.ts}`);
        if (payload?.ts !== parsed?.ts) reasons.push(`ts_mismatch:${payload?.ts}!=${parsed?.ts}`);
        if (!isNonNegativeInteger(payloadSequence)) reasons.push(`seq_not_int:${payloadSequence} (orig_payload_seq=${payload?.seq}, envelope_seq=${parsed?.seq})`);
        if (!updateBytes) reasons.push(`updateBytes_invalid: type=${typeof payload?.update} isArray=${Array.isArray(payload?.update)} constructor=${payload?.update?.constructor?.name} len=${payload?.update?.length}`);
        logger.warn('[sync][debug] payload validation FAILED at index', i, 'reasons:', reasons.join(' | '));
        throw malformedRemoteUpdate();
      }

      decodedUpdates.push({
        noteId: payload.noteId,
        update: updateBytes,
        device: payload.device,
        ts: payload.ts,
        seq: payloadSequence,
      });
    }

    return { updates: decodedUpdates, cursorsDelta, hasMore };
  }

  async push(cursors, opts = {}) {
    if (!this._remoteAllowed()) {
      logger.info('[sync] cloud push: _remoteAllowed=false');
      return { updates: [], cursorsDelta: {}, pushed: 0 };
    }

    const workspaceId = await this._ensureWorkspace();
    if (!workspaceId) {
      logger.info('[sync] cloud push: no active workspace');
      return { updates: [], cursorsDelta: {}, pushed: 0 };
    }

    const force = opts?.force === true;
    if (!force && this._throttled()) {
      logger.info('[sync] cloud push: throttled');
      return { updates: [], cursorsDelta: {}, pushed: 0, throttled: true };
    }

    const ownDeviceId = getSyncDeviceId();
    const remoteCursor = cursors[workspaceId] || {};
    const ownCursor = Object.values(remoteCursor).reduce((latest, note) => {
      const candidate = note?.[ownDeviceId];
      return candidate && (candidate.ts > latest.ts || (candidate.ts === latest.ts && candidate.sequence > latest.sequence))
        ? { ts: candidate.ts, sequence: candidate.sequence }
        : latest;
    }, { ts: 0, sequence: 0 });

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
      const batch = this._cloudBuffer.map((item) => ({
        ...item,
        sequence: (nextSequences.get(item.noteId) ?? remoteCursor[item.noteId]?.[ownDeviceId]?.sequence ?? 0) + 1,
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

      const cursorsDelta = {};
      const checkpoints = acknowledgedCheckpoints(result, [...notesMap.keys()]);
      for (const [noteId, checkpoint] of Object.entries(checkpoints)) {
        if (checkpoint?.deviceId !== ownDeviceId) continue;
        cursorsDelta[workspaceId] ||= {};
        cursorsDelta[workspaceId][noteId] = {
          [ownDeviceId]: { ts: checkpoint.ts, sequence: checkpoint.sequence },
        };
      }
      const acknowledged = new Set();
      for (const item of batch) {
        const checkpoint = checkpoints[item.noteId];
        if (checkpoint && item.sequence <= checkpoint.sequence) acknowledged.add(item);
      }
      for (let index = this._cloudBuffer.length - 1; index >= 0; index--) {
        if (acknowledged.has(batch[index])) this._cloudBuffer.splice(index, 1);
      }
      return { updates: [], cursorsDelta, pushed: totalPushed };
    }

    // Folder sync mode: read from commits directory
    const commitsDir = await getCommitsDir();
    if (!commitsDir) {
      return { updates: [], cursorsDelta: {}, pushed: 0 };
    }

    const allFiles = await readDir(commitsDir).catch(() => []);
    const pushedFiles = allFiles.filter((f) => f.endsWith(YJS_UPDATE_EXT) && f !== '._seeded');
    logger.info('[sync] cloud push commitsDir:', commitsDir, '| files:', pushedFiles.length, '/', allFiles.length, '| cursor:', JSON.stringify(ownCursor));

    // Build full file map (all devices, for probe check)
    const allFilesByNoteId = new Map();
    for (const file of pushedFiles) {
      const parsed = parseSyncFilename(file);
      if (!parsed) continue;
      if (!allFilesByNoteId.has(parsed.docId)) {
        allFilesByNoteId.set(parsed.docId, []);
      }
      allFilesByNoteId.get(parsed.docId).push({ file, parsed });
    }

    // Filter by cursor (current device only)
    let filesByNoteId = new Map();
    for (const [noteId, files] of allFilesByNoteId) {
      const filtered = files.filter(({ parsed }) =>
        parsed.device === ownDeviceId &&
        (() => {
          const noteCursor = remoteCursor[parsed.docId]?.[ownDeviceId] || { ts: 0, sequence: 0 };
          return parsed.ts > noteCursor.ts || (parsed.ts === noteCursor.ts && (parsed.seq ?? 0) > noteCursor.sequence);
        })()
      );
      if (filtered.length > 0) filesByNoteId.set(noteId, filtered);
    }

    let totalPushed = 0;
    let pushCursorTs = ownCursor.ts;
    let pushCursorSeq = ownCursor.sequence;
    let acknowledgedCheckpoint = null;

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
          key: `${parsed.docId}~~${parsed.device}~~${parsed.ts}~~${parsed.seq ?? 0}${YJS_UPDATE_EXT}`,
          data: btoa(typeof raw === 'string' ? raw : raw.toString()),
          deviceId: parsed.device,
          ts: parsed.ts,
          sequence: parsed.seq ?? 0,
        });
        batchBytes += fileBytes;

        if (parsed.ts > pushCursorTs || (parsed.ts === pushCursorTs && (parsed.seq ?? 0) > pushCursorSeq)) {
          pushCursorTs = parsed.ts;
          pushCursorSeq = parsed.seq ?? 0;
        }

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
        acknowledgedCheckpoint = acknowledgedCheckpoints(result, [...filesByNoteId.keys()]);
        logger.info('[sync] cloud push result:', JSON.stringify(result));
      } catch (e) {
        console.error('[sync] cloud push error:', e?.status, e?.message, JSON.stringify(e?.body) || '');
        throw e;
      }
    } else if (ownCursor.ts > 0 && allFilesByNoteId.size > 0 && !this._serverProbeComplete) {
      logger.info('[sync] cloud push: cursor stale check — cursor:', JSON.stringify(ownCursor), 'files:', allFilesByNoteId.size);
      // Cursor says "already pushed" but server might be empty (reset, data loss).
      // Probe once: pull with empty cursor for first note. If server returns nothing, it's empty.
      let probePush = false;
      try {
        let state;
        try {
          state = await getRemoteState(workspaceId);
        } catch (stateErr) {
          // 404 = workspace has no sync state yet, treat as empty
          // 403 = user is not a workspace member, reset workspace
          if (stateErr?.status === 404 || stateErr?.statusCode === 404) {
            logger.info('[sync] cloud push: probe got 404 — treating as empty workspace');
            state = { status: 'empty', documents: [] };
          } else if (stateErr?.status === 403 || stateErr?.statusCode === 403) {
            logger.info('[sync] cloud push: probe got 403 — resetting workspace');
            const workspaceStore = useWorkspaceStore();
            workspaceStore.activeId = null;
            this._cachedWorkspaceId = null;
            this._serverProbeComplete = true;
            return { updates: [], cursorsDelta: {}, pushed: 0 };
          } else {
            throw stateErr;
          }
        }
        if (!isValidRemoteState(state)) {
          throw malformedRemoteState();
        }
        const serverEmpty = isAuthoritativelyEmpty(state);
        logger.info('[sync] cloud push: probe state — empty:', serverEmpty, 'status:', state?.status);
        if (!serverEmpty) {
          this._serverProbeComplete = true;
        } else {
          logger.info('[sync] cloud push: probe found empty server, resetting stale cursor');
          pushCursorTs = 0;
          pushCursorSeq = 0;
          filesByNoteId = allFilesByNoteId;
          batchNotes = [];
          for (const [noteId, files] of filesByNoteId) {
            const noteUpdates = [];
            for (const { file, parsed } of files) {
              let raw;
              try { raw = await readFile(path.join(commitsDir, file)); } catch { continue; }
              if (!raw) continue;
               noteUpdates.push({ key: `${parsed.docId}~~${parsed.device}~~${parsed.ts}~~${parsed.seq ?? 0}${YJS_UPDATE_EXT}`, data: btoa(typeof raw === 'string' ? raw : raw.toString()), deviceId: parsed.device, ts: parsed.ts, sequence: parsed.seq ?? 0 });
              if (parsed.ts > pushCursorTs || (parsed.ts === pushCursorTs && (parsed.seq ?? 0) > pushCursorSeq)) {
                pushCursorTs = parsed.ts;
                pushCursorSeq = parsed.seq ?? 0;
              }
            }
            if (noteUpdates.length > 0) batchNotes.push({ noteId, updates: noteUpdates });
          }
          if (batchNotes.length > 0) {
            probePush = true;
            const result = await remotePushUpdates(workspaceId, batchNotes);
            totalPushed = (result.accepted || 0) + (result.duplicate || 0);
            acknowledgedCheckpoint = acknowledgedCheckpoints(result, [...filesByNoteId.keys()]);
            this._serverProbeComplete = true;
          }
        }
      } catch (e) {
        if (probePush) throw e;
        if (e?.code === 'sync-state-invalid') throw e;
        logger.info('[sync] cloud push: probe failed:', e?.status, e?.message);
        // Server unreachable — will retry next cycle (don't set _serverProbeComplete)
      }
    }

    logger.info('[sync] cloud push totalPushed:', totalPushed, '| cursor:', JSON.stringify({ ts: pushCursorTs, seq: pushCursorSeq }));
    this._lastPushedAt = Date.now();

    const cursorsDelta = {};
    for (const [noteId, checkpoint] of Object.entries(acknowledgedCheckpoint || {})) {
      if (checkpoint?.deviceId !== ownDeviceId) continue;
      cursorsDelta[workspaceId] ||= {};
      cursorsDelta[workspaceId][noteId] = {
        [ownDeviceId]: { ts: checkpoint.ts, sequence: checkpoint.sequence },
      };
    }

    return { updates: [], cursorsDelta, pushed: totalPushed };
  }

  async seedOnce() {
    // Cloud-only mode: skip disk-based seeding
    if (this._cloudBuffer) return;

    const commitsDir = await getCommitsDir();
    if (!commitsDir) return;

    try {
      const files = await readDir(commitsDir).catch(() => []);
      if (files.some((f) => f === '._seeded')) return;

      const { writeFile: writeFs } = await import('@/lib/native/fs');
      const { path: tauriPath } = await import('@/lib/tauri-bridge');
      const wroteMarker = await writeFs(
        tauriPath.join(commitsDir, '._seeded'), ''
      ).then(() => true, () => false);
      if (!wroteMarker) return;

      const hasYjsFiles = files.some((f) => f.endsWith(YJS_UPDATE_EXT));
      if (!hasYjsFiles) {
        await writeInitialSnapshots(commitsDir);
      }
    } catch {
      // best-effort
    }
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
        seq: 0,
        noteId: META_DOC_ID,
        update: Array.from(wsState),
      }, `${META_DOC_ID}-${ts}`);
      snapshots.push({ noteId: META_DOC_ID, data: btoa(encrypted) });
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
              seq: 0,
              noteId,
              update: Array.from(state),
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
      const assetFiles = [];
      for (const assetType of ASSET_TYPES) {
        const localBase = `${appDir}/${assetType}`;
        const noteDirIds = await readDir(localBase).catch(() => []);
        for (const nid of noteDirIds) {
          const noteDir = `${localBase}/${nid}`;
          const files = await readDir(noteDir).catch(() => []);
          for (const file of files) {
            const flatKey = encodeAssetKey(assetType, nid, file);
            assetKeys.push(flatKey);
            assetFiles.push({ key: flatKey, localPath: `${noteDir}/${file}` });
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
          const file = assetFiles.find(f => f.key === assetKey);
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
        if (!allUrls.find((u) => u.assetKey === op.flatKey)) {
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
    const t = this.getTransportSetting();
    const want = normalizeSyncTransport(t) === 'remote';
    if (!want) {
      logger.info('[sync] _remoteAllowed: transport setting is', JSON.stringify(t), '— not remote');
      return false;
    }
    const state = this.getAccountState();
    logger.info('[sync] _remoteAllowed: isAuth=', state.isAuth, 'plan=', state.plan);
    if (!state.isAuth) return false;
    const subPlan = state.subscription?.plan ?? state.plan;
    if (subPlan && subPlan !== 'free') return true;
    logger.info('[sync] _remoteAllowed: cloud sync not available for plan', subPlan);
    return false;
  }

  _throttled() {
    return Date.now() - this._lastPushedAt < CLOUD_PUSH_MIN_INTERVAL_MS;
  }
}
