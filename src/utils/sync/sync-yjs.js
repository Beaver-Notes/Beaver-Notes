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
  let s = str;
  const SANITIZE_MAP = [
    ['\x00', '__NULL__'],
    ['\n', '__NEWLINE__'],
    ['\r', '__CR__'],
    ['\t', '__TAB__'],
    ['/', '__SLASH__'],
    ['\\', '__BSLASH__'],
    [':', '__COLON__'],
    ['*', '__STAR__'],
    ['?', '__QMARK__'],
    ['"', '__QUOTE__'],
    ['<', '__LT__'],
    ['>', '__GT__'],
    ['|', '__PIPE__'],
  ];
  for (const [ch, replacement] of SANITIZE_MAP) {
    s = s.replaceAll(ch, replacement);
  }
  return s;
}

function unsanitizeFromFilename(str) {
  let s = str;
  const UNSANITIZE_MAP = [
    ['__NULL__', '\x00'],
    ['__NEWLINE__', '\n'],
    ['__CR__', '\r'],
    ['__TAB__', '\t'],
    ['__SLASH__', '/'],
    ['__BSLASH__', '\\'],
    ['__COLON__', ':'],
    ['__STAR__', '*'],
    ['__QMARK__', '?'],
    ['__QUOTE__', '"'],
    ['__LT__', '<'],
    ['__GT__', '>'],
    ['__PIPE__', '|'],
  ];
  for (const [pattern, result] of UNSANITIZE_MAP) {
    s = s.replaceAll(pattern, result);
  }
  return s;
}

const FILENAME_SEP = '~~';

function yjsFileName(noteId, ts, sequence, deviceId) {
  const seqPart = sequence != null ? `${FILENAME_SEP}${sequence}` : '';
  return `${sanitizeForFilename(noteId)}${FILENAME_SEP}${deviceId}${FILENAME_SEP}${ts}${seqPart}${YJS_UPDATE_EXT}`;
}

function yjsSnapshotFileName(docId, ts, deviceId) {
  return `${sanitizeForFilename(docId)}${FILENAME_SEP}snapshot${FILENAME_SEP}${deviceId}${FILENAME_SEP}${ts}${YJS_UPDATE_EXT}`;
}

export function parseSyncFilename(file) {
  if (!file.endsWith(YJS_UPDATE_EXT)) return null;

  const base = file.slice(0, -YJS_UPDATE_EXT.length);

  const parts = base.split(FILENAME_SEP);
  if (parts.length < 3) return null;

  const last = parts[parts.length - 1];
  const lastNum = Number(last);
  const secondLast = parts.length >= 2 ? parts[parts.length - 2] : null;
  const secondLastNum = secondLast != null ? Number(secondLast) : NaN;

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

  if (parts.length === 0) return null;
  const device = parts[parts.length - 1];
  parts.pop();

  let isSnapshot = false;
  if (parts.length > 0 && parts[parts.length - 1] === 'snapshot') {
    isSnapshot = true;
    parts.pop();
  }

  const docId = unsanitizeFromFilename(parts.join(FILENAME_SEP));
  if (!docId) return null;

  return { docId, isSnapshot, device, ts, sequence };
}

let _writeSeq = 0;
function _nextWriteSeq() {
  _writeSeq = (_writeSeq + 1) % 1000;
  return _writeSeq;
}

export async function writeYjsUpdate(commitsDir, noteId, update, encryptJSON, stateVector) {
  const ts = Date.now();
  const sequence = _nextWriteSeq();
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
  const encrypted = await encryptJSON(payload, `${noteId}-${ts}`);
  const fileName = yjsFileName(noteId, ts, sequence, deviceId);
  await writeSyncFile(path.join(commitsDir, fileName), encrypted);
}

export async function writeYjsSnapshot(commitsDir, docId, state, encryptJSON, stateVector) {
  const ts = Date.now();
  const deviceId = await getSyncDeviceId();
  const payload = {
    device: deviceId,
    ts,
    noteId: docId,
    update: state,
  };
  if (stateVector) {
    payload.stateVector = stateVector;
  }
  const encrypted = await encryptJSON(payload, `${docId}-snapshot-${ts}`);
  const fileName = yjsSnapshotFileName(docId, ts, deviceId);
  await writeSyncFile(path.join(commitsDir, fileName), encrypted);
}

export async function listRemoteYjsUpdates(commitsDir, cursors, decryptJSON, stateVector, readTimeoutMs = STALLED_READ_MS) {
  let files;
  try {
    files = await withTimeout(readSyncDir(commitsDir), readTimeoutMs, 'folder listing');
  } catch {
    return [];
  }

  const deviceId = await getSyncDeviceId();
  const updates = [];

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

    let payload;
    try {
      const raw = await withTimeout(readSyncFile(path.join(commitsDir, file)), readTimeoutMs, `read ${file}`);

      const aadSuffix = parsed.isSnapshot
        ? `${parsed.docId}-snapshot-${parsed.ts}`
        : `${parsed.docId}-${parsed.ts}`;

      payload = await decryptJSON(raw, aadSuffix);
    } catch {
      continue;
    }
    if (!payload?.device || !payload?.noteId || !payload?.update) continue;

    updates.push({
      device: payload.device,
      ts: payload.ts,
      sequence: parsed.sequence ?? payload.sequence ?? 0,
      noteId: payload.noteId,
      update: new Uint8Array(payload.update),
      stateVector: payload.stateVector || null,
    });
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
      } catch {

      }
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
