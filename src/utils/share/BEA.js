import { useNoteStore } from '../../store/note';
import { useLabelStore } from '@/store/label';
import { useI18nStore } from '@/store/i18n';
import { readNoteContents } from '@/lib/yjs/meta-store.js';
import { nanoid } from 'nanoid';
import { path } from '@/lib/tauri-bridge';
import { getAppDirectory } from '@/lib/native/app';
import { readDir, stat } from '@/lib/native/fs';
import {
  chooseExportDirectory,
  ensureExportDir,
  readExportData,
  readImportJson,
  writeExportJson,
  writeExportFile,
} from '@/lib/native/exports';
import { sanitizeNoteContent } from '@/utils/note/contentSecurity.js';
import { sanitizeFilename } from '@/utils/import/helpers.js';
import { errorMessage } from '@/lib/tauri/errors';

// SC-4-10: untrusted .bea payloads are bounded before they can OOM the
// renderer (readJson/JSON.parse + per-asset atob). Generous for legitimate
// note assets, fatal only for bombs.
const MAX_IMPORT_FILE_BYTES = 256 * 1024 * 1024;
const MAX_ASSET_BASE64_LENGTH = 64 * 1024 * 1024;
const MAX_IMPORTED_ASSETS = 2000;

// SC-4-01: the note id from a .bea file is attacker-controlled and feeds
// storage paths; only nanoid-shaped ids (no separators, dots or JS magic
// keys) are honored, everything else gets a locally generated id.
const SAFE_NOTE_ID_RE = /^(?!(?:__proto__|constructor|prototype)$)[A-Za-z0-9_-]{1,64}$/;

export function safeImportedNoteId(id) {
  const value = String(id || '');
  return SAFE_NOTE_ID_RE.test(value) ? value : '';
}

const MAX_ASSET_KEY_LENGTH = 255;
const ASSET_KEY_CONTROL_RE = /[\0-\x1f\x7f]/;

/**
 * Asset keys come straight from the imported .bea JSON and are joined onto a
 * storage path, so validate before sanitize (SC-4-01). Rejects absolute
 * paths, '..'/'.' segments, control chars, whitespace-only and overlong
 * keys. Everything else (spaces, unicode, dots) is a legitimate filename
 * and is flattened by sanitizeFilename at write time.
 */
export function isSafeAssetKey(key) {
  if (typeof key !== 'string') return false;
  const value = key.trim();
  if (!value || value.length > MAX_ASSET_KEY_LENGTH) return false;
  if (ASSET_KEY_CONTROL_RE.test(value)) return false;
  if (
    value.startsWith('/') ||
    value.startsWith('\\') ||
    /^[A-Za-z]:/.test(value)
  ) {
    return false;
  }
  const segments = value.split(/[/\\]/);
  if (segments.some((seg) => seg === '' || seg === '.' || seg === '..')) {
    return false;
  }
  return true;
}

export function isInsideDir(target, dir) {
  const norm = (p) => String(p).replace(/\\/g, '/').replace(/\/+$/, '');
  const cleanDir = norm(dir);
  return norm(target).startsWith(`${cleanDir}/`);
}

export function decodeImportedAsset(base64Data) {
  if (
    typeof base64Data !== 'string' ||
    !base64Data ||
    base64Data.length > MAX_ASSET_BASE64_LENGTH
  ) {
    return null;
  }
  try {
    const decoded = atob(base64Data);
    if (!decoded) return null;
    return Uint8Array.from(decoded, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

/**
 * Point asset refs at the id the note actually got. Needed when a crafted
 * id was rejected and the store generated its own (SC-4-01).
 */
export function rewriteImportedAssetRefs(content, fromId, toId) {
  const from = String(fromId || '');
  if (!from || from === toId) return content;
  const prefixes = ['assets://', 'file-assets://'];
  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    if (typeof node.attrs?.src === 'string') {
      prefixes.forEach((scheme) => {
        const fromPrefix = `${scheme}${from}/`;
        if (node.attrs.src.startsWith(fromPrefix)) {
          node.attrs.src = `${scheme}${toId}/${node.attrs.src.slice(fromPrefix.length)}`;
        }
      });
    }
    if (Array.isArray(node.content)) node.content.forEach(walk);
    if (Array.isArray(node.marks)) node.marks.forEach(walk);
  };
  walk(content);
  return content;
}

function getShareTranslations() {
  try {
    return useI18nStore().messages?.share || {};
  } catch {
    return {};
  }
}

async function encodeAssets(sourcePath) {
  const assets = {};
  try {
    const files = await readDir(sourcePath);
    for (const file of files) {
      const filePath = path.join(sourcePath, file);
      const base64Data = await readExportData(filePath);
      if (!base64Data) {
        console.warn(`File ${file} could not be read or is empty.`);
        assets[file] = '';
        continue;
      }
      assets[file] = base64Data;
    }
  } catch (error) {
    console.error(`Error reading assets from ${sourcePath}:`, error);
  }
  return assets;
}

async function chooseRootExportDir(title) {
  const { canceled, filePaths = [] } = await chooseExportDirectory(title);
  if (canceled || !filePaths.length) return null;
  return filePaths[0];
}

export async function exportBEA(noteId, noteTitle) {
  const noteStore = useNoteStore();
  const share = getShareTranslations();
  try {
    const rootDir = await chooseRootExportDir(
      share.exportNoteDialogTitle || 'Export note'
    );
    if (!rootDir) return;
    const noteToExport = noteStore.data[noteId];
    if (!noteToExport) {
      console.warn(`Note with ID ${noteId} not found for export.`);
      return;
    }
    const appDirectory = await getAppDirectory();
    const assetsSource = path.join(appDirectory, 'assets', noteId);
    const assets = {
      notesAssets: await encodeAssets(assetsSource),
      fileAssets: {},
    };
    // Content lives in per-note Yjs docs; fall back to any in-memory copy.
    const contents = await readNoteContents([noteId]);
    const exportedData = {
      data: {
        id: noteId,
        title: noteToExport.title,
        content: contents[noteId] ?? noteToExport.content,
        isLocked: !!noteToExport.isLocked,
        assets,
        labels: noteToExport.labels || [],
      },
    };
    const outputFileName = `${noteTitle}.bea`;
    await writeExportJson(path.join(rootDir, outputFileName), exportedData);
  } catch (error) {
    console.error(error);
  }
}

export async function importBEA(filePath, router, store, folderId = null) {
  const share = getShareTranslations();
  try {
    // SC-4-10: cap the file before the bridge reads + parses it.
    const info = await stat(filePath).catch(() => null);
    if (info && Number.isFinite(info.size) && info.size > MAX_IMPORT_FILE_BYTES) {
      throw new Error(share.fileTooLarge || 'Imported file is too large.');
    }
    const fileContent = await readImportJson(filePath);
    if (!fileContent || !fileContent.data)
      throw new Error(
        share.invalidFileFormat || 'Invalid file format or empty file.'
      );
    const fileData = fileContent.data;
    if (
      !fileData.id ||
      !fileData.title ||
      !fileData.content ||
      typeof fileData.content !== 'object' ||
      !fileData.assets
    )
      throw new Error(
        share.missingEssentialFields ||
          'Missing essential note fields in the imported file.'
      );
    const { notesAssets, fileAssets } = fileData.assets;
    if (typeof notesAssets !== 'object' || typeof fileAssets !== 'object')
      throw new Error(
        share.invalidAssetsStructure ||
          'Invalid assets structure in the imported note.'
      );
    await processImportedNote(fileData, router, folderId);
    return true;
  } catch (error) {
    console.error('Error importing note:', error);
    return { success: false, message: errorMessage(error) };
  }
}

async function processImportedNote(noteData, router, folderId = null) {
  const noteStore = useNoteStore();
  const labelStore = useLabelStore();
  try {
    const appDirectory = await getAppDirectory();
    for (const label of noteData.labels || []) {
      if (!labelStore.data.includes(label)) await labelStore.add(label);
    }
    const isLocked =
      typeof noteData.isLocked === 'boolean'
        ? noteData.isLocked
        : !!(noteData.lockedNotes && noteData.lockedNotes[claimedId]);
    // SC-4-01: honor the claimed id only when it is a safe shape; otherwise
    // generate one locally and re-point asset refs at it. `noteId` — never
    // the raw file value — drives storage paths below.
    const claimedId = safeImportedNoteId(noteData.id);
    const noteId = claimedId || nanoid();
    const content = sanitizeNoteContent(noteData.content);
    if (noteId !== String(noteData.id ?? '')) {
      rewriteImportedAssetRefs(content, noteData.id, noteId);
    }
    const notePayload = {
      id: noteId,
      title: noteData.title,
      content,
      labels: noteData.labels || [],
      folderId,
      isLocked,
    };
    if (noteStore.data[noteId]) await noteStore.update(noteId, notePayload);
    else await noteStore.add(notePayload);
    if (noteData.assets) {
      const { notesAssets, fileAssets } = noteData.assets;
      const assetsDir = path.join(appDirectory, 'assets', noteId);
      await ensureExportDir(assetsDir);
      let written = 0;
      outer: for (const assets of [notesAssets, fileAssets]) {
        for (const [filename, base64Data] of Object.entries(assets || {})) {
          if (written >= MAX_IMPORTED_ASSETS) {
            console.warn('Imported asset count cap reached; rest skipped.');
            break outer;
          }
          // Asset keys come straight from the imported JSON: reject hostile
          // keys, sanitize the rest, and verify the join stays inside this
          // note's own asset prefix. One bad entry never aborts the import
          // (SC-4-01).
          if (!isSafeAssetKey(filename)) {
            console.warn(
              `Asset "${String(filename).slice(0, 80)}" rejected (unsafe key); skipping.`
            );
            continue;
          }
          const safeName = sanitizeFilename(filename);
          const target = path.join(assetsDir, safeName);
          if (!isInsideDir(target, assetsDir)) {
            console.warn(
              `Asset "${safeName}" escapes the note asset dir; skipping.`
            );
            continue;
          }
          const data = decodeImportedAsset(base64Data);
          if (!data) {
            console.warn(`Asset "${safeName}" skipped (size cap or invalid base64).`);
            continue;
          }
          try {
            await writeExportFile(target, data);
            written += 1;
          } catch (error) {
            console.warn(`Asset "${safeName}" could not be written:`, error);
          }
        }
      }
    }
    await noteStore.retrieve();
    router.push(`/note/${noteId}`);
  } catch (error) {
    console.error('Error processing imported note:', error);
    throw error;
  }
}
