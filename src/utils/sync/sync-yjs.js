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

/**
 * Replace characters that are illegal / problematic in filenames across
 * macOS / Windows / Linux with safe substitutes.  The mapping is reversible
 * so the original noteId can be recovered when reading files back.
 */
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

function yjsFileName(noteId, ts, seq) {
  const seqPart = seq != null ? `${FILENAME_SEP}${seq}` : '';
  return `${sanitizeForFilename(noteId)}${FILENAME_SEP}${deviceId}${FILENAME_SEP}${ts}${seqPart}${YJS_UPDATE_EXT}`;
}

function yjsSnapshotFileName(docId, ts) {
  return `${sanitizeForFilename(docId)}${FILENAME_SEP}snapshot${FILENAME_SEP}${deviceId}${FILENAME_SEP}${ts}${YJS_UPDATE_EXT}`;
}

/**
 * Parse a sync filename back into { docId, isSnapshot, device, ts, seq }.
 *
 * Filename formats (segments separated by FILENAME_SEP = "~~"):
 *   update:        {noteId}~~{deviceId}~~{ts}.yjs.json
 *   update+seq:    {noteId}~~{deviceId}~~{ts}~~{seq}.yjs.json
 *   snapshot:      {docId}~~snapshot~~{deviceId}~~{ts}.yjs.json
 *
 * Because noteId / docId / deviceId may themselves contain dashes, we use an
 * unambiguous delimiter and split positionally from the right.
 */
function parseSyncFilename(file) {
  if (!file.endsWith(YJS_UPDATE_EXT)) return null;

  // Strip extension
  const base = file.slice(0, -YJS_UPDATE_EXT.length);

  const parts = base.split(FILENAME_SEP);
  if (parts.length < 3) return null;

  // 1. Timestamp is the final numeric segment.  If the segment before it is also
  //    numeric (0-999), treat that as an optional sequence disambiguator.  The
  //    two-numeric pattern uniquely identifies a seq (snapshot files never carry
  //    a seq and device IDs are UUIDs, not 0-999 numbers).
  const last = parts[parts.length - 1];
  const secondLast = parts.length >= 2 ? parts[parts.length - 2] : null;
  const tsCandidate = Number(last);
  if (!Number.isFinite(tsCandidate)) return null;

  let seq;
  let ts = tsCandidate;
  parts.pop();

  if (secondLast != null) {
    const seqCandidate = Number(secondLast);
    if (Number.isInteger(seqCandidate) && seqCandidate >= 0 && seqCandidate <= 999) {
      seq = seqCandidate;
      parts.pop();
    }
  }

  // 2. Device id is the segment right before the timestamp (or seq)
  if (parts.length === 0) return null;
  const device = parts[parts.length - 1];
  parts.pop();

  // 3. Optional "snapshot" marker before the device id
  let isSnapshot = false;
  if (parts.length > 0 && parts[parts.length - 1] === 'snapshot') {
    isSnapshot = true;
    parts.pop();
  }

  // 4. Everything remaining is the doc id
  const docId = unsanitizeFromFilename(parts.join(FILENAME_SEP));
  if (!docId) return null;

  return { docId, isSnapshot, device, ts, seq };
}

/**
 * Write a single Yjs update to the shared commits/ directory.
 * Uses a monotonic counter to avoid filename collisions when multiple
 * flushes land in the same millisecond.
 */
let _writeSeq = 0;
function _nextWriteSeq() {
  _writeSeq = (_writeSeq + 1) % 1000;
  return _writeSeq;
}

export async function writeYjsUpdate(commitsDir, noteId, update, encryptJSON) {
  const ts = Date.now();
  const seq = _nextWriteSeq();
  const payload = {
    device: deviceId,
    ts,
    seq,
    noteId,
    update: Array.from(update),
  };
  const encrypted = await encryptJSON(payload, `${noteId}-${ts}`);
  const fileName = yjsFileName(noteId, ts, seq);
  await writeSyncFile(path.join(commitsDir, fileName), encrypted);
}

/**
 * Write a full Ydoc state snapshot to the shared commits/ directory.
 * Used on first sync (commits dir empty) so new devices get the full
 * workspace without needing a separate genesis file.
 */
export async function writeYjsSnapshot(commitsDir, docId, state, encryptJSON) {
  const ts = Date.now();
  const payload = {
    device: deviceId,
    ts,
    noteId: docId,
    update: Array.from(state),
  };
  const encrypted = await encryptJSON(payload, `${docId}-snapshot-${ts}`);
  const fileName = yjsSnapshotFileName(docId, ts);
  await writeSyncFile(path.join(commitsDir, fileName), encrypted);
}

/**
 * List Yjs update files from other devices in the commits/ directory.
 * Returns entries sorted by timestamp.
 */
export async function listRemoteYjsUpdates(commitsDir, cursors, decryptJSON) {
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

    // Cheap, pre-decrypt filtering using filename metadata:
    // skip our own files and anything already covered by the cursor.
    if (parsed.device === deviceId) continue;

    const cursorKey = `yjs-${parsed.device}`;
    const seen = cursors[cursorKey];
    const seenTs = seen?.ts ?? 0;
    const seenSeq = seen?.seq ?? 0;
    if (parsed.ts < seenTs) continue;
    if (parsed.ts === seenTs && (parsed.seq ?? 0) <= seenSeq) continue;

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
      seq: parsed.seq ?? payload.seq ?? 0,
      noteId: payload.noteId,
      update: new Uint8Array(payload.update),
    });
  }

  // Sort by (ts, seq) so that cursor advance is monotonic per device:
  // a file with the same ts but higher seq is always processed later.
  return updates.sort((a, b) => a.ts - b.ts || a.seq - b.seq);
}

// ─── Workspace compaction ───────────────────────────────────────────────────

const WORKSPACE_COMPACTION_THRESHOLD = 50;

/**
 * Compact all workspace .yjs.json files (incremental + old snapshots) into a
 * single full-state snapshot file per docId.  Called from the sync loop when
 * the number of files for a given docId exceeds the threshold so that a new
 * device only needs to read + decrypt one file per doc instead of potentially
 * thousands.  Both the workspace meta doc and every per-note doc are compacted
 * this way — previously only `meta` files were merged, leaving every note's
 * incremental updates as permanent files that accumulated forever.
 */
export async function compactWorkspaceYjs(commitsDir, decryptJSON, encryptJSON) {
  let files;
  try {
    files = await readSyncDir(commitsDir);
  } catch {
    return;
  }

  // Group files by their docId (parsed from the unambiguous filename).
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
    await writeYjsSnapshot(commitsDir, docId, state, encryptJSON);

    for (const { file } of entries) {
      await removeSyncPath(path.join(commitsDir, file)).catch(() => {});
    }

    doc.destroy();
  }
}
