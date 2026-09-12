import * as Y from 'yjs';
import { path } from '@/lib/tauri-bridge';
import {
  readDir as readSyncDir,
  readFile as readSyncFile,
  writeFile as writeSyncFile,
  removePath as removeSyncPath,
} from '@/lib/native/fs';
import {
  YJS_UPDATE_EXT,
} from './constants.js';
import { getSyncDeviceId } from './sync-repository.js';

const STALLED_READ_MS = 5000;

export function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`sync: ${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise.finally(() => clearTimeout(timer)), timeout]);
}

function sanitizeForFilename(str) {
  return encodeURIComponent(str);
}

function unsanitizeFromFilename(str) {
  try {
    return decodeURIComponent(str);
  } catch {
    return str;
  }
}

const FILENAME_SEP = '~~';

function yjsFileName(noteId, ts, sequence, deviceId) {
  return `${sanitizeForFilename(noteId)}${FILENAME_SEP}${encodeURIComponent(deviceId)}${FILENAME_SEP}${ts}${FILENAME_SEP}${sequence}${YJS_UPDATE_EXT}`;
}

function yjsSnapshotFileName(docId, ts, deviceId) {
  return `${sanitizeForFilename(docId)}${FILENAME_SEP}snapshot${FILENAME_SEP}${encodeURIComponent(deviceId)}${FILENAME_SEP}${ts}${YJS_UPDATE_EXT}`;
}

export function parseSyncFilename(file) {
  if (!file.endsWith(YJS_UPDATE_EXT)) return null;
  const base = file.slice(0, -YJS_UPDATE_EXT.length);
  const parts = base.split(FILENAME_SEP);
  if (parts.length < 3) return null;
  const last = parts[parts.length - 1];
  const lastNum = Number(last);
  const secondLastNum = Number(parts[parts.length - 2]);
  let sequence;
  let ts;
  if (parts.length >= 4 && parts[parts.length - 3] !== 'snapshot' &&
    Number.isInteger(lastNum) && lastNum >= 0 && Number.isFinite(secondLastNum)) {
    sequence = lastNum;
    ts = secondLastNum;
    parts.pop();
    parts.pop();
  } else if (Number.isFinite(lastNum)) {
    ts = lastNum;
    parts.pop();
  } else {
    return null;
  }
  const device = parts[parts.length - 1];
  parts.pop();
  let isSnapshot = false;
  if (parts.length > 0 && parts[parts.length - 1] === 'snapshot') {
    isSnapshot = true;
    parts.pop();
  }
  if (parts.length === 0) return null;
  const docId = unsanitizeFromFilename(parts.join(FILENAME_SEP));
  if (!docId) return null;
  return { docId, isSnapshot, device, ts, sequence };
}

const SEQ_KEY = 'sync:write-seq';
let _writeSeq = 0;
try {
  _writeSeq = Number(localStorage.getItem(SEQ_KEY)) || 0;
} catch {}
function _nextWriteSeq() {
  _writeSeq += 1;
  try {
    localStorage.setItem(SEQ_KEY, String(_writeSeq));
  } catch {}
  return _writeSeq;
}

async function writeYjsFile(commitsDir, noteId, update, encryptJSON, stateVector, isSnapshot) {
  const ts = Date.now();
  const sequence = isSnapshot ? 0 : _nextWriteSeq();
  const deviceId = await getSyncDeviceId();
  const payload = {
    device: deviceId,
    ts,
    sequence,
    noteId,
    update,
  };
  if (stateVector) {
    payload.stateVector = stateVector;
  }
  const aad = isSnapshot ? `${noteId}-snapshot-${ts}` : `${noteId}-${ts}`;
  const encrypted = await encryptJSON(payload, aad);
  const fileName = isSnapshot
    ? yjsSnapshotFileName(noteId, ts, deviceId)
    : yjsFileName(noteId, ts, sequence, deviceId);
  await writeSyncFile(path.join(commitsDir, fileName), encrypted);
}

export async function writeYjsUpdate(commitsDir, noteId, update, encryptJSON, stateVector) {
  return writeYjsFile(commitsDir, noteId, update, encryptJSON, stateVector, false);
}

export async function writeYjsSnapshot(commitsDir, docId, state, encryptJSON, stateVector) {
  return writeYjsFile(commitsDir, docId, state, encryptJSON, stateVector, true);
}

export async function listRemoteYjsUpdates(commitsDir, cursors, decryptJSON, stateVector, readTimeoutMs = STALLED_READ_MS) {
  let files;
  try {
    files = await withTimeout(readSyncDir(commitsDir), readTimeoutMs, 'folder listing');
  } catch {
    return [];
  }
  const deviceId = await getSyncDeviceId();
  const candidates = [];
  for (const file of files.filter((f) => f.endsWith(YJS_UPDATE_EXT))) {
    const parsed = parseSyncFilename(file);
    if (!parsed) continue;
    if (parsed.device === deviceId) continue;
    if (stateVector) {
      const maxClock = stateVector[parsed.device];
      if (maxClock != null && (parsed.sequence ?? 0) <= maxClock) continue;
    }
    const cursorKey = `yjs-${parsed.device}`;
    const seen = cursors[cursorKey];
    const seenTs = seen?.ts ?? 0;
    const seenSeq = seen?.sequence ?? 0;
    if (parsed.ts < seenTs) continue;
    if (parsed.ts === seenTs && (parsed.sequence ?? 0) <= seenSeq) continue;
    candidates.push({ file, parsed });
  }
  const CONCURRENCY = 8;
  const updates = [];
  let decryptFailures = 0;
  let decryptBatch;
  try {
    ({ decryptBatch } = await import('./crypto.js'));
    if (typeof decryptBatch !== 'function') decryptBatch = undefined;
  } catch {
    decryptBatch = undefined;
  }
  for (let i = 0; i < candidates.length; i += CONCURRENCY) {
    const slice = candidates.slice(i, i + CONCURRENCY);
    const raws = await Promise.all(
      slice.map(({ file }) =>
        withTimeout(readSyncFile(path.join(commitsDir, file)), readTimeoutMs, `read ${file}`).catch(() => null)
      )
    );
    const toDecrypt = [];
    const toDecryptIdx = [];
    slice.forEach(({ parsed }, k) => {
      const raw = raws[k];
      if (!raw) return;
      const aadSuffix = parsed.isSnapshot
        ? `${parsed.docId}-snapshot-${parsed.ts}`
        : `${parsed.docId}-${parsed.ts}`;
      toDecrypt.push({ raw, aadSuffix, k });
      toDecryptIdx.push(k);
    });
    let decrypted = [];
    if (toDecrypt.length > 0 && decryptBatch) {
      try {
        decrypted = await decryptBatch(
          toDecrypt.map((d) => d.raw),
          toDecrypt.map((d) => d.aadSuffix)
        );
      } catch {
        decrypted = [];
      }
    }
    if (decrypted.length !== toDecrypt.length) {
      decrypted = toDecrypt.map(() => null);
      for (let j = 0; j < toDecrypt.length; j++) {
        try {
          decrypted[j] = await decryptJSON(toDecrypt[j].raw, toDecrypt[j].aadSuffix);
        } catch {
          decrypted[j] = null;
          decryptFailures++;
        }
      }
    } else {
      decrypted.forEach((d) => {
        if (!d) decryptFailures++;
      });
    }
    slice.forEach(({ parsed }, k) => {
      const di = toDecryptIdx.indexOf(k);
      if (di < 0) return;
      const payload = decrypted[di];
      if (!payload?.device || !payload?.noteId || !payload?.update) return;
      updates.push({
        device: payload.device,
        ts: payload.ts,
        sequence: parsed.sequence ?? payload.sequence ?? 0,
        noteId: payload.noteId,
        update: new Uint8Array(payload.update),
        stateVector: payload.stateVector || null,
      });
    });
    if ((i / CONCURRENCY) % 4 === 3) {
      await new Promise((r) => setTimeout(r, 0));
    }
  }
  if (candidates.length > 0 && updates.length === 0 && decryptFailures >= candidates.length) {
    const err = new Error('Sync folder cannot be decrypted');
    err.code = 'DECRYPT_FAILED';
    throw err;
  }
  return updates.sort((a, b) => a.ts - b.ts || a.sequence - b.sequence);
}

const WORKSPACE_COMPACTION_THRESHOLD = 50;

export async function compactWorkspaceYjs(commitsDir, decryptJSON, encryptJSON) {
  let files;
  try {
    files = await readSyncDir(commitsDir);
  } catch {
    return;
  }
  const groups = new Map();
  for (const file of files) {
    if (!file.endsWith(YJS_UPDATE_EXT)) continue;
    const parsed = parseSyncFilename(file);
    if (!parsed) continue;
    if (!groups.has(parsed.docId)) groups.set(parsed.docId, []);
    groups.get(parsed.docId).push({ file, parsed });
  }
  for (const [docId, entries] of groups) {
    if (entries.length < WORKSPACE_COMPACTION_THRESHOLD) continue;
    const doc = new Y.Doc();
    for (const { file, parsed } of entries) {
      try {
        const raw = await readSyncFile(path.join(commitsDir, file));
        const aadSuffix = parsed.isSnapshot
          ? `${parsed.docId}-snapshot-${parsed.ts}`
          : `${parsed.docId}-${parsed.ts}`;
        const payload = await decryptJSON(raw, aadSuffix);
        if (payload?.update) {
          Y.applyUpdate(doc, new Uint8Array(payload.update));
        }
      } catch {}
    }
    const state = Y.encodeStateAsUpdate(doc);
    const sv = Y.encodeStateVector(doc);
    await writeYjsSnapshot(commitsDir, docId, state, encryptJSON, sv);
    for (const { file } of entries) {
      await removeSyncPath(path.join(commitsDir, file)).catch(() => {});
    }
    doc.destroy();
  }
}
