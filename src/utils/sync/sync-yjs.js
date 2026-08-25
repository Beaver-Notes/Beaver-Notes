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

const deviceId = getSyncDeviceId();

// Reversible sanitization of characters illegal in filenames on macOS/Windows/Linux,
// so the original id can be recovered when reading files back.
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

// `~~` is a delimiter that cannot appear in any component: it is filesystem-legal
// on macOS / Windows / Linux and is never produced by sanitizeForFilename.  This
// lets us split filenames positionally without ambiguity (deviceId is a UUID
// containing dashes, which broke the old dash-delimited parser).
const FILENAME_SEP = '~~';

function yjsFileName(noteId, ts, sequence) {
  const seqPart = sequence != null ? `${FILENAME_SEP}${sequence}` : '';
  return `${sanitizeForFilename(noteId)}${FILENAME_SEP}${deviceId}${FILENAME_SEP}${ts}${seqPart}${YJS_UPDATE_EXT}`;
}

function yjsSnapshotFileName(docId, ts) {
  return `${sanitizeForFilename(docId)}${FILENAME_SEP}snapshot${FILENAME_SEP}${deviceId}${FILENAME_SEP}${ts}${YJS_UPDATE_EXT}`;
}

/**
 * Parse a sync filename back into { docId, isSnapshot, device, ts, sequence }.
 *
 * Filename formats (segments separated by FILENAME_SEP = "~~"):
 *   update:        {noteId}~~{deviceId}~~{ts}.yjs.json
 *   update+seq:    {noteId}~~{deviceId}~~{ts}~~{sequence}.yjs.json
 *   snapshot:      {docId}~~snapshot~~{deviceId}~~{ts}.yjs.json
 */
export function parseSyncFilename(file) {
  if (!file.endsWith(YJS_UPDATE_EXT)) return null;

  const base = file.slice(0, -YJS_UPDATE_EXT.length);

  const parts = base.split(FILENAME_SEP);
  if (parts.length < 3) return null;

  // Four-segment update carries an explicit sequence (may exceed the legacy 999 cap);
  // snapshots have a marker before the device and never carry a sequence.
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

  // 4. Everything remaining is the doc id
  const docId = unsanitizeFromFilename(parts.join(FILENAME_SEP));
  if (!docId) return null;

  return { docId, isSnapshot, device, ts, sequence };
}

/**
 * Write a single Yjs update to the shared commits/ directory; a monotonic
 * counter disambiguates multiple flushes in the same millisecond.
 */
let _writeSeq = 0;
function _nextWriteSeq() {
  _writeSeq = (_writeSeq + 1) % 1000;
  return _writeSeq;
}

export async function writeYjsUpdate(commitsDir, noteId, update, encryptJSON, stateVector) {
  const ts = Date.now();
  const sequence = _nextWriteSeq();
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
  const fileName = yjsFileName(noteId, ts, sequence);
  await writeSyncFile(path.join(commitsDir, fileName), encrypted);
}

/**
 * Write a full Ydoc snapshot so first-sync devices get the whole workspace
 * from one file instead of replaying a genesis history.
 */
export async function writeYjsSnapshot(commitsDir, docId, state, encryptJSON, stateVector) {
  const ts = Date.now();
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
  const fileName = yjsSnapshotFileName(docId, ts);
  await writeSyncFile(path.join(commitsDir, fileName), encrypted);
}

/**
 * List Yjs update files from other devices, sorted by timestamp.
 *
 * @param {string} commitsDir
 * @param {Object} cursors — legacy cursor map (kept for backwards compat)
 * @param {Function} decryptJSON
 * @param {Record<string, number>} [stateVector] — optional { [deviceId]: maxClock }
 *   for pre-decrypt filtering: sequence <= clock is skipped without reading/decrypting.
 */
export async function listRemoteYjsUpdates(commitsDir, cursors, decryptJSON, stateVector) {
  let files;
  try {
    files = await readSyncDir(commitsDir);
  } catch {
    return [];
  }

  const updates = [];

  for (const file of files.filter((f) => f.endsWith(YJS_UPDATE_EXT))) {
    const parsed = parseSyncFilename(file);
    if (!parsed) continue;

    // Cheap pre-decrypt filtering from filename metadata:
    if (parsed.device === deviceId) continue;

    // Primary filter — skip if sequence <= maxClock for this device.
    if (stateVector) {
      const maxClock = stateVector[parsed.device];
      if (maxClock != null && (parsed.sequence ?? 0) <= maxClock) continue;
    }

    // Legacy cursor filter (backwards compat with callers still passing cursors).
    const cursorKey = `yjs-${parsed.device}`;
    const seen = cursors[cursorKey];
    const seenTs = seen?.ts ?? 0;
    const seenSeq = seen?.sequence ?? 0;
    if (parsed.ts < seenTs) continue;
    if (parsed.ts === seenTs && (parsed.sequence ?? 0) <= seenSeq) continue;

    let payload;
    try {
      const raw = await readSyncFile(path.join(commitsDir, file));

      // Reconstruct the AAD used at encryption time
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

  // Sort by (ts, sequence) so cursor advance stays monotonic per device.
  return updates.sort((a, b) => a.ts - b.ts || a.sequence - b.sequence);
}

const WORKSPACE_COMPACTION_THRESHOLD = 50;

/**
 * Compact a doc's .yjs.json files (incremental + old snapshots) into one
 * full-state snapshot once the count exceeds the threshold, so a new device
 * decrypts a single file per doc instead of potentially thousands.
 */
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
        // skip corrupt / undecryptable files
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
