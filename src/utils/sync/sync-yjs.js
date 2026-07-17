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
  return str
    .replace(/\//g, '__SLASH__')
    .replace(/\\/g, '__BSLASH__')
    .replace(/:/g, '__COLON__')
    .replace(/\*/g, '__STAR__')
    .replace(/\?/g, '__QMARK__')
    .replace(/"/g, '__QUOTE__')
    .replace(/</g, '__LT__')
    .replace(/>/g, '__GT__')
    .replace(/\|/g, '__PIPE__');
}

function unsanitizeFromFilename(str) {
  return str
    .replace(/__SLASH__/g, '/')
    .replace(/__BSLASH__/g, '\\')
    .replace(/__COLON__/g, ':')
    .replace(/__STAR__/g, '*')
    .replace(/__QMARK__/g, '?')
    .replace(/__QUOTE__/g, '"')
    .replace(/__LT__/g, '<')
    .replace(/__GT__/g, '>')
    .replace(/__PIPE__/g, '|');
}

// `~~` is a delimiter that cannot appear in any component: it is filesystem-legal
// on macOS / Windows / Linux and is never produced by sanitizeForFilename.  This
// lets us split filenames positionally without ambiguity (deviceId is a UUID
// containing dashes, which broke the old dash-delimited parser).
const FILENAME_SEP = '~~';

function yjsFileName(noteId, ts) {
  return `${sanitizeForFilename(noteId)}${FILENAME_SEP}${deviceId}${FILENAME_SEP}${ts}${YJS_UPDATE_EXT}`;
}

function yjsSnapshotFileName(docId, ts) {
  return `${sanitizeForFilename(docId)}${FILENAME_SEP}snapshot${FILENAME_SEP}${deviceId}${FILENAME_SEP}${ts}${YJS_UPDATE_EXT}`;
}

/**
 * Parse a sync filename back into { docId, isSnapshot, device, ts }.
 *
 * Filename formats (segments separated by FILENAME_SEP = "~~"):
 *   update:   {noteId}~~{deviceId}~~{ts}.yjs.json
 *   snapshot: {docId}~~snapshot~~{deviceId}~~{ts}.yjs.json
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

  // 1. Timestamp is the final segment
  const ts = Number(parts[parts.length - 1]);
  if (!Number.isFinite(ts)) return null;
  parts.pop();

  // 2. Device id is the segment right before the timestamp
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

  return { docId, isSnapshot, device, ts };
}

/**
 * Write a single Yjs update to the shared commits/ directory.
 */
export async function writeYjsUpdate(commitsDir, noteId, update, encryptJSON) {
  const ts = Date.now();
  const payload = {
    device: deviceId,
    ts,
    noteId,
    update: Array.from(update),
  };
  const encrypted = await encryptJSON(payload, `${noteId}-${ts}`);
  const fileName = yjsFileName(noteId, ts);
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
    const seenUpTo = cursors[cursorKey] ?? 0;
    if (parsed.ts <= seenUpTo) continue;

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
      noteId: payload.noteId,
      update: new Uint8Array(payload.update),
    });
  }

  return updates.sort((a, b) => a.ts - b.ts);
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
