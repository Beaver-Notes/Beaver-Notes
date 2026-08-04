import { Transport } from './transport.js';
import {
  pushUpdates as remotePushUpdates,
  pullUpdates as remotePullUpdates,
} from '../remote-yjs.js';
import { parseSyncFilename } from '../sync-yjs.js';
import { ensureCommitsDir, getSyncDeviceId } from '../sync-repository.js';
import { getSyncPath } from '../path.js';
import { YJS_UPDATE_EXT } from '../constants.js';
import { readDir, readFile } from '@/lib/native/fs';
import { path } from '@/lib/tauri-bridge';

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
  }

  async pull(cursors) {
    if (!this._remoteAllowed()) return { updates: [], cursorsDelta: {} };

    const { decryptJSON } = await import('../crypto.js');
    const remoteUpdates = await remotePullUpdates(cursors).catch(() => []);

    const updates = [];
    for (const upd of remoteUpdates) {
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
    if (!this._remoteAllowed()) return { updates: [], cursorsDelta: {}, pushed: 0 };

    const force = opts?.force === true;
    if (!force && this._throttled()) {
      return { updates: [], cursorsDelta: {}, pushed: 0, throttled: true };
    }

    const syncPath = await getSyncPath();
    if (!syncPath) return { updates: [], cursorsDelta: {}, pushed: 0 };
    const commitsDir = await ensureCommitsDir(syncPath);
    const ownDeviceId = getSyncDeviceId();
    const ownCursorKey = `yjs-${ownDeviceId}`;
    const ownCursor = cursors[ownCursorKey] || { ts: 0, seq: 0 };

    const flushedFiles = await readDir(commitsDir).catch(() => []);
    const pushBatch = [];
    let batchBytes = 0;
    let pushCursorTs = ownCursor.ts;
    let pushCursorSeq = ownCursor.seq;

    for (const file of flushedFiles) {
      if (!file.endsWith(YJS_UPDATE_EXT) || file === '._seeded') continue;
      const parsed = parseSyncFilename(file);
      if (!parsed || parsed.device !== ownDeviceId) continue;
      if (parsed.ts < ownCursor.ts) continue;
      if (parsed.ts === ownCursor.ts && (parsed.seq ?? 0) <= ownCursor.seq) continue;

      let raw;
      try {
        raw = await readFile(path.join(commitsDir, file));
      } catch {
        continue;
      }
      if (!raw) continue;

      const fileBytes = raw.byteLength ?? raw.length ?? 0;

      if (batchBytes + fileBytes > CLOUD_PUSH_MAX_BATCH_BYTES && pushBatch.length > 0) {
        await remotePushUpdates(pushBatch.splice(0));
        batchBytes = 0;
      }

      pushBatch.push({ key: file, data: btoa(raw) });
      batchBytes += fileBytes;

      if (parsed.ts > pushCursorTs || (parsed.ts === pushCursorTs && (parsed.seq ?? 0) > pushCursorSeq)) {
        pushCursorTs = parsed.ts;
        pushCursorSeq = parsed.seq ?? 0;
      }

      if (pushBatch.length >= CLOUD_PUSH_MAX_FILES_PER_POST) {
        await remotePushUpdates(pushBatch.splice(0));
        batchBytes = 0;
      }
    }

    if (pushBatch.length > 0) {
      await remotePushUpdates(pushBatch);
    }

    this._lastPushedAt = Date.now();

    const cursorsDelta = {};
    if (pushCursorTs > ownCursor.ts || (pushCursorTs === ownCursor.ts && pushCursorSeq > ownCursor.seq)) {
      cursorsDelta[ownCursorKey] = { ts: pushCursorTs, seq: pushCursorSeq };
    }

    return { updates: [], cursorsDelta, pushed: pushBatch.length };
  }

  async seedOnce() {
    // no-op — server handles seeding
  }

  async compact() {
    // no-op — server handles compaction
  }

  _remoteAllowed() {
    const t = this.getTransportSetting();
    const want = t === 'remote' || t === 'both';
    if (!want) return false;
    const { isAuth, plan } = this.getAccountState();
    return isAuth && (plan === 'basic' || plan === 'pro' || plan === 'enterprise');
  }

  _throttled() {
    return Date.now() - this._lastPushedAt < CLOUD_PUSH_MIN_INTERVAL_MS;
  }
}
