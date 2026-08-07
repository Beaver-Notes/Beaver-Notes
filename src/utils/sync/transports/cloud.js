import { Transport } from './transport.js';
import {
  pushUpdates as remotePushUpdates,
  pullUpdates as remotePullUpdates,
} from '../remote-yjs.js';
import {
  listRemoteAssets,
  uploadAsset,
  batchUploadAssets,
  downloadAsset,
  deleteRemoteAsset,
  encodeAssetKey,
  decodeAssetKey,
  presignBatchUpload,
  confirmSeed,
} from '../remote-assets.js';
import { parseSyncFilename } from '../sync-yjs.js';
import { getSyncDeviceId, getCommitsDir } from '../sync-repository.js';
import { writeInitialSnapshots } from './seed.js';
import { YJS_UPDATE_EXT, ASSET_TYPES } from '../constants.js';
import { readDir, readFile, readFileBinary, writeFile as writeFs, ensureDir, pathExists } from '@/lib/native/fs';
import { path } from '@/lib/tauri-bridge';
import { localAssetName } from '../crypto.js';
import { yMapToObj } from '@/utils/yjs-helpers.js';
import { getWorkspaceDoc } from '@/composable/meta-yjs-doc.js';
import { mergeIntoMap } from '@/composable/useWorkspaceYjs';
import { useWorkspaceStore } from '@/store/workspace.ts';
import * as Y from 'yjs';
import { getSnapshot, getUpdates } from '@/lib/native/yjs.js';
import { toUint8Array, applyUpdatesToDoc } from '@/utils/yjs-helpers.js';
import { META_DOC_ID } from '@/composable/meta-yjs-doc.js';

const CLOUD_PUSH_MIN_INTERVAL_MS = 30_000;
const CLOUD_PUSH_MAX_BATCH_BYTES = 256 * 1024;
const CLOUD_PUSH_MAX_FILES_PER_POST = 50;

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
      }
    } catch (err) {
      console.warn('[sync] cloud: direct workspace fetch failed:', err?.status, err?.message);
    }
    return workspaceStore.activeId || this._cachedWorkspaceId;
  }

  async pull(cursors) {
    if (!this._remoteAllowed()) return { updates: [], cursorsDelta: {} };

    const workspaceId = await this._ensureWorkspace();
    if (!workspaceId) {
      console.log('[sync] cloud pull: no active workspace');
      return { updates: [], cursorsDelta: {} };
    }

    // Group cursor keys by noteId: "yjs-{deviceId}" cursors are workspace-level,
    // but we need per-note pulls. Extract noteIds from cursor keys that contain them.
    // Cursor format: "yjs-{deviceId}" (legacy) or "{noteId}:{deviceId}" (new)
    const noteCursors = {};
    for (const [key, val] of Object.entries(cursors)) {
      const parts = key.split(':');
      if (parts.length === 2) {
        const [noteId, deviceId] = parts;
        if (!noteCursors[noteId]) noteCursors[noteId] = {};
        noteCursors[noteId][deviceId] = val;
      } else if (parts.length === 1 && parts[0].startsWith('yjs-')) {
        // Legacy cursor format — no noteId context, skip (will get full pull)
      }
    }

    const allUpdates = [];

    if (Object.keys(noteCursors).length > 0) {
      // Batch pull using note-scoped cursors — single request for all notes
      const notes = Object.entries(noteCursors).map(([noteId, cursors]) => ({ noteId, cursors }));
      const batchResult = await remotePullUpdates(workspaceId, notes).catch((err) => {
        console.error('[sync] cloud batch pull error:', err?.status, err?.message);
        return {};
      });
      for (const [noteId, updates] of Object.entries(batchResult)) {
        allUpdates.push(...updates);
      }
    } else {
      // No note-scoped cursors — pull all notes (initial sync or legacy cursor format)
      // Try to discover noteIds from the commits directory (folder sync mode)
      const commitsDir = await getCommitsDir();
      if (commitsDir) {
        const files = await readDir(commitsDir).catch(() => []);
        const noteIds = new Set();
        for (const file of files) {
          if (!file.endsWith(YJS_UPDATE_EXT) || file === '._seeded') continue;
          const parsed = parseSyncFilename(file);
          if (parsed?.docId) noteIds.add(parsed.docId);
        }

        // Batch pull all discovered notes — single request
        if (noteIds.size > 0) {
          const notes = [...noteIds].map((noteId) => ({ noteId, cursors: {} }));
          const batchResult = await remotePullUpdates(workspaceId, notes).catch((err) => {
            console.error('[sync] cloud batch pull error:', err?.status, err?.message);
            return {};
          });
          for (const [noteId, updates] of Object.entries(batchResult)) {
            allUpdates.push(...updates);
          }
        }
      }
      // Cloud-only mode with no cursors and no commits dir: skip (will get updates on next push)
    }

    const { decryptJSON } = await import('../crypto.js');

    const updates = [];
    for (const upd of allUpdates) {
      let payload, parsed;
      try {
        const raw = atob(upd.data);
        parsed = parseSyncFilename(upd.key);
        const aadSuffix = parsed?.isSnapshot
          ? `${parsed.docId}-snapshot-${parsed.ts}`
          : `${parsed.docId}-${parsed.ts}`;
        payload = await decryptJSON(raw, aadSuffix);
      } catch {
        continue;
      }
      if (!payload?.device || !payload?.noteId || !payload?.update) continue;

      updates.push({
        noteId: payload.noteId,
        update: new Uint8Array(payload.update),
        device: payload.device,
        ts: payload.ts,
        seq: parsed?.seq ?? payload.seq ?? 0,
      });
    }

    return { updates, cursorsDelta: {} };
  }

  async push(cursors, opts = {}) {
    if (!this._remoteAllowed()) {
      console.log('[sync] cloud push: _remoteAllowed=false');
      return { updates: [], cursorsDelta: {}, pushed: 0 };
    }

    const workspaceId = await this._ensureWorkspace();
    if (!workspaceId) {
      console.log('[sync] cloud push: no active workspace');
      return { updates: [], cursorsDelta: {}, pushed: 0 };
    }

    const force = opts?.force === true;
    if (!force && this._throttled()) {
      console.log('[sync] cloud push: throttled');
      return { updates: [], cursorsDelta: {}, pushed: 0, throttled: true };
    }

    // First push of the session: if server is empty, seed with local state
    if (!this._serverProbeComplete) {
      this._serverProbeComplete = true;
      try {
        const seeded = await this.seedCloudOnce();
        if (seeded) {
          console.log('[sync] cloud push: server seeded from local state');
        }
      } catch (err) {
        console.warn('[sync] cloud push: seedCloudOnce failed:', err?.message);
      }
    }

    const ownDeviceId = getSyncDeviceId();
    const ownCursorKey = `yjs-${ownDeviceId}`;
    const ownCursor = cursors[ownCursorKey] || { ts: 0, seq: 0 };

    // Cloud-only mode: push from in-memory buffer (no disk files)
    if (this._cloudBuffer.length > 0) {
      const { encryptJSON } = await import('../crypto.js');
      const batch = this._cloudBuffer.splice(0);
      const notesMap = new Map();
      for (const { noteId, update } of batch) {
        if (!notesMap.has(noteId)) notesMap.set(noteId, []);
        const ts = Date.now();
        const encrypted = await encryptJSON({
          device: ownDeviceId,
          ts,
          seq: 0,
          noteId,
          update,
        }, `${noteId}-${ts}`);
        notesMap.get(noteId).push({
          key: `${noteId}~~${ownDeviceId}~~${ts}~~0${YJS_UPDATE_EXT}`,
          data: encrypted,
        });
      }

      const notes = [...notesMap.entries()].map(([noteId, updates]) => ({ noteId, updates }));
      const result = await remotePushUpdates(workspaceId, notes);
      const totalPushed = result.stored || 0;
      const ts = Date.now();

      console.log('[sync] cloud push (cloud-only) totalPushed:', totalPushed);
      this._lastPushedAt = Date.now();

      const cursorsDelta = {};
      if (ts > ownCursor.ts) {
        cursorsDelta[ownCursorKey] = { ts, seq: 0 };
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
    console.log('[sync] cloud push commitsDir:', commitsDir, '| files:', pushedFiles.length, '/', allFiles.length, '| cursor:', JSON.stringify(ownCursor));

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
        (parsed.ts > ownCursor.ts || (parsed.ts === ownCursor.ts && (parsed.seq ?? 0) > ownCursor.seq))
      );
      if (filtered.length > 0) filesByNoteId.set(noteId, filtered);
    }

    let totalPushed = 0;
    let pushCursorTs = ownCursor.ts;
    let pushCursorSeq = ownCursor.seq;

    // Collect all note updates for batch push
    let batchNotes = [];
    for (const [noteId, files] of filesByNoteId) {
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

        noteUpdates.push({ key: file, data: typeof raw === 'string' ? raw : raw.toString() });
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
    console.log('[sync] cloud push batchNotes:', batchNotes.length, '| notes total updates:', batchNotes.reduce((s, n) => s + n.updates.length, 0));
    if (batchNotes.length > 0) {
      try {
        const result = await remotePushUpdates(workspaceId, batchNotes);
        totalPushed = result.stored || 0;
        console.log('[sync] cloud push result:', JSON.stringify(result));
      } catch (e) {
        console.error('[sync] cloud push error:', e?.status, e?.message);
      }
    } else if (ownCursor.ts > 0 && allFilesByNoteId.size > 0 && !this._serverProbeComplete) {
      console.log('[sync] cloud push: cursor stale check — cursor:', JSON.stringify(ownCursor), 'files:', allFilesByNoteId.size);
      // Cursor says "already pushed" but server might be empty (reset, data loss).
      // Probe once: pull with empty cursor for first note. If server returns nothing, it's empty.
      const probeNoteId = allFilesByNoteId.keys().next().value;
      try {
        const probe = await remotePullUpdates(workspaceId, [{
          noteId: probeNoteId,
          cursors: {},
        }]);
        // Probe succeeded — mark complete so we don't retry
        this._serverProbeComplete = true;
        const hasData = probe && Object.values(probe).some((arr) => arr?.length > 0);
        console.log('[sync] cloud push: probe result — hasData:', hasData, 'keys:', probe ? Object.keys(probe) : 'null');
        if (!hasData) {
          console.log('[sync] cloud push: probe found empty server, resetting stale cursor');
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
              noteUpdates.push({ key: file, data: typeof raw === 'string' ? raw : raw.toString() });
              if (parsed.ts > pushCursorTs || (parsed.ts === pushCursorTs && (parsed.seq ?? 0) > pushCursorSeq)) {
                pushCursorTs = parsed.ts;
                pushCursorSeq = parsed.seq ?? 0;
              }
            }
            if (noteUpdates.length > 0) batchNotes.push({ noteId, updates: noteUpdates });
          }
          if (batchNotes.length > 0) {
            const result = await remotePushUpdates(workspaceId, batchNotes);
            totalPushed = result.stored || 0;
            if (totalPushed > 0) {
              this._probeResetCursor = true;
              pushCursorTs = Date.now();
              pushCursorSeq = 0;
            }
          }
        }
      } catch (e) {
        console.log('[sync] cloud push: probe failed:', e?.status, e?.message);
        // Server unreachable — will retry next cycle (don't set _serverProbeComplete)
      }
    }

    console.log('[sync] cloud push totalPushed:', totalPushed, '| cursor:', JSON.stringify({ ts: pushCursorTs, seq: pushCursorSeq }));
    this._lastPushedAt = Date.now();

    const cursorsDelta = {};
    if (this._probeResetCursor || pushCursorTs > ownCursor.ts || (pushCursorTs === ownCursor.ts && pushCursorSeq > ownCursor.seq)) {
      cursorsDelta[ownCursorKey] = { ts: pushCursorTs, seq: pushCursorSeq };
      this._probeResetCursor = false;
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
    if (!this._remoteAllowed()) return false;

    const workspaceId = await this._ensureWorkspace();
    if (!workspaceId) return false;

    // Check if server already has data — only seed when empty
    try {
      const probe = await remotePullUpdates(workspaceId, [{
        noteId: '__probe__',
        cursors: {},
      }]);
      const hasData = probe && Object.values(probe).some((arr) => arr?.length > 0);
      if (hasData) return false;
    } catch {
      return false;
    }

    console.log('[sync] cloud seed: server empty, pushing initial state');
    const { encryptJSON } = await import('../crypto.js');
    const ownDeviceId = getSyncDeviceId();
    const ts = Date.now();
    const batchNotes = [];

    // Seed workspace doc
    try {
      const workspaceDoc = getWorkspaceDoc();
      const state = Y.encodeStateAsUpdate(workspaceDoc);
      if (state.byteLength > 0) {
        const encrypted = await encryptJSON({
          device: ownDeviceId,
          ts,
          seq: 0,
          noteId: META_DOC_ID,
          update: Array.from(state),
        }, `${META_DOC_ID}-${ts}`);
        batchNotes.push({
          noteId: META_DOC_ID,
          updates: [{
            key: `${META_DOC_ID}~~${ownDeviceId}~~${ts}~~0${YJS_UPDATE_EXT}`,
            data: encrypted,
          }],
        });
      }
    } catch (err) {
      console.warn('[sync] cloud seed: workspace doc failed:', err);
    }

    // Seed all notes
    const workspaceDoc = getWorkspaceDoc();
    const notesMap = workspaceDoc.getMap('notes');
    const noteIds = Array.from(notesMap.keys()).filter(
      (id) => typeof id === 'string' && id.trim().length > 0 && id !== 'undefined'
    );

    for (const noteId of noteIds) {
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
            const noteTs = ts + batchNotes.length;
            const encrypted = await encryptJSON({
              device: ownDeviceId,
              ts: noteTs,
              seq: 0,
              noteId,
              update: Array.from(state),
            }, `${noteId}-${noteTs}`);
            batchNotes.push({
              noteId,
              updates: [{
                key: `${noteId}~~${ownDeviceId}~~${noteTs}~~0${YJS_UPDATE_EXT}`,
                data: encrypted,
              }],
            });
          }
        } finally {
          doc.destroy();
        }
      } catch (err) {
        console.warn('[sync] cloud seed: note failed:', noteId, err);
      }
    }

    if (batchNotes.length === 0) {
      console.log('[sync] cloud seed: nothing to push');
      return false;
    }

    console.log(`[sync] cloud seed: pushing ${batchNotes.length} docs`);
    try {
      const result = await remotePushUpdates(workspaceId, batchNotes);
      const stored = result.stored || 0;
      console.log('[sync] cloud seed: pushed', stored, 'updates');
      this._lastPushedAt = Date.now();

      // Seed assets via direct R2 upload (presigned URLs)
      try {
        const { getAppDirectory } = await import('@/lib/native/app');
        const appDir = await getAppDirectory();
        if (appDir) {
          const assetKeys = [];
          const assetFiles = [];
          for (const assetType of ASSET_TYPES) {
            const localBase = `${appDir}/${assetType}`;
            const noteIds = await readDir(localBase).catch(() => []);
            for (const noteId of noteIds) {
              const noteDir = `${localBase}/${noteId}`;
              const files = await readDir(noteDir).catch(() => []);
              for (const file of files) {
                const flatKey = encodeAssetKey(assetType, noteId, file);
                assetKeys.push(flatKey);
                assetFiles.push({ key: flatKey, localPath: `${noteDir}/${file}` });
              }
            }
          }

          if (assetKeys.length > 0) {
            const PRESIGN_CHUNK = 200;
            const allUrls = [];
            for (let i = 0; i < assetKeys.length; i += PRESIGN_CHUNK) {
              const chunk = assetKeys.slice(i, i + PRESIGN_CHUNK);
              console.log(`[sync] cloud seed: presigning ${chunk.length} assets (${i}/${assetKeys.length})`);
              const urls = await presignBatchUpload(chunk);
              allUrls.push(...urls);
            }
            console.log(`[sync] cloud seed: ${allUrls.length} presigned URLs for ${assetKeys.length} assets`);
            if (allUrls.length > 0) {
              const CONCURRENT = 5;
              let uploaded = 0;
              for (let i = 0; i < allUrls.length; i += CONCURRENT) {
                const batch = allUrls.slice(i, i + CONCURRENT);
                await Promise.all(batch.map(async ({ assetKey, url }) => {
                  const file = assetFiles.find(f => f.key === assetKey);
                  if (!file) return;
                  try {
                    const data = await readFileBinary(file.localPath);
                    const bytes = data instanceof Uint8Array ? data : new Uint8Array(Array.isArray(data) ? data : Array.from(data));
                    if (!bytes || bytes.byteLength === 0) return;
                    await fetch(url, {
                      method: 'PUT',
                      body: bytes,
                      headers: { 'Content-Type': 'application/octet-stream' },
                    });
                    uploaded++;
                  } catch (err) {
                    console.warn('[sync] cloud seed: asset upload failed:', assetKey, err?.message);
                  }
                }));
                console.log(`[sync] cloud seed: uploaded ${Math.min(i + CONCURRENT, allUrls.length)}/${allUrls.length} assets`);
              }
              if (uploaded > 0) {
                await confirmSeed(assetKeys);
                console.log('[sync] cloud seed: confirmed', uploaded, 'assets');
              }
            }
          }
        }
      } catch (err) {
        console.warn('[sync] cloud seed: asset upload failed:', err?.message);
      }

      return stored > 0;
    } catch (err) {
      console.error('[sync] cloud seed: push failed:', err?.status, err?.message);
      return false;
    }
  }

  async compact() {
    // no-op — server handles compaction
  }

  async syncAssets(onProgress) {
    if (!this._remoteAllowed()) return;

    const { getAppDirectory } = await import('@/lib/native/app');
    const appDir = await getAppDirectory();
    if (!appDir) {
      console.log('[sync] syncAssets: no appDir');
      return;
    }

    console.log('[sync] syncAssets appDir:', appDir);

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
        .catch((e) => { console.log('[sync] syncAssets readDir failed:', assetType, e?.message); return []; });

      console.log('[sync] syncAssets', assetType, 'noteIds:', localNoteIds.length);

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
    console.log('[sync] syncAssets total ops:', total, '| remote:', remoteKeys.length);
    if (total === 0) return;
    let processed = 0;

    onProgress?.({ phase: 'assets-scan', processed: 0, total });

    const BATCH_MAX_BYTES = 5 * 1024 * 1024;
    const BATCH_DELAY_MS = 500;
    const INDIVIDUAL_DELAY_MS = 1500;

    const uploads = ops.filter((op) => op.type === 'upload');
    const others = ops.filter((op) => op.type !== 'upload');

    const batches = [];
    let currentBatch = [];
    let currentBytes = 0;
    for (const op of uploads) {
      try {
        const rawData = await readFileBinary(op.src);
        const data = rawData instanceof Uint8Array
          ? rawData
          : new Uint8Array(Array.isArray(rawData) ? rawData : Array.from(rawData));
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
        if (currentBatch.length > 0 && currentBytes + itemBytes > BATCH_MAX_BYTES) {
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
        console.log(`[sync] batch ${batchNum}/${batches.length}: uploaded=${uploaded} skipped=${skipped} items=${batch.length}`);
      }

      if (!result) {
        // Request failed entirely — fall back to individual
        console.log(`[sync] batch request failed, falling back to individual for ${batch.length} items`);
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
        console.log(`[sync] batch had ${errorItems.length} errors, falling back to individual for ${batch.length} items`);
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

    const DOWNLOAD_DELAY_MS = 500;
    const DOWNLOAD_BACKOFF_THRESHOLD = 5;
    for (const op of others) {
      try {
        if (op.type === 'download') {
          const failures = this._failedDownloads.get(op.flatKey) || 0;
          if (failures >= DOWNLOAD_BACKOFF_THRESHOLD) {
            console.log('[sync] skipping repeatedly failed download:', op.flatKey);
            processed++;
            onProgress?.({ phase: 'assets', processed, total });
            continue;
          }
          const data = await downloadAsset(op.flatKey);
          if (data) {
            await ensureDir(path.dirname(op.dest)).catch(() => {});
            await writeFs(op.dest, data);
            this._failedDownloads.delete(op.flatKey);
          } else {
            this._failedDownloads.set(op.flatKey, failures + 1);
          }
          await new Promise((r) => setTimeout(r, DOWNLOAD_DELAY_MS));
        } else if (op.type === 'remove-local') {
          const { removePath } = await import('@/lib/native/fs');
          await removePath(op.src).catch(() => {});
        }
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
    const want = t === 'remote' || t === 'both';
    if (!want) {
      console.log('[sync] _remoteAllowed: transport setting is', JSON.stringify(t), '— not remote/both');
      return false;
    }
    const state = this.getAccountState();
    console.log('[sync] _remoteAllowed: isAuth=', state.isAuth, 'plan=', state.plan);
    return state.isAuth;
  }

  _throttled() {
    return Date.now() - this._lastPushedAt < CLOUD_PUSH_MIN_INTERVAL_MS;
  }
}
