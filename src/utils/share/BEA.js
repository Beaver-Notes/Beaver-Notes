import { useNoteStore } from '../../store/note';
import { useLabelStore } from '@/store/label';
import { useI18nStore } from '@/store/i18n';
import { readNoteContents } from '@/lib/yjs/meta-store.js';
import { path } from '@/lib/tauri-bridge';
import { getAppDirectory } from '@/lib/native/app';
import { readDir } from '@/lib/native/fs';
import {
  chooseExportDirectory,
  ensureExportDir,
  readExportData,
  readImportJson,
  writeExportJson,
  writeExportFile,
} from '@/lib/native/exports';
import { sanitizeNoteContent } from '@/utils/note/contentSecurity.js';
import { errorMessage } from '@/lib/tauri/errors';

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
        : !!(noteData.lockedNotes && noteData.lockedNotes[noteData.id]);
    const notePayload = {
      id: noteData.id,
      title: noteData.title,
      content: sanitizeNoteContent(noteData.content),
      labels: noteData.labels || [],
      folderId,
      isLocked,
    };
    if (noteStore.data[noteData.id])
      await noteStore.update(noteData.id, notePayload);
    else await noteStore.add(notePayload);
    if (noteData.assets) {
      const { notesAssets, fileAssets } = noteData.assets;
      const assetsDir = path.join(appDirectory, 'assets', noteData.id);
      await ensureExportDir(assetsDir);
      for (const [filename, base64Data] of Object.entries(notesAssets || {})) {
        await writeExportFile(
          path.join(assetsDir, filename),
          Uint8Array.from(atob(base64Data), (c) => c.charCodeAt(0))
        );
      }
      for (const [filename, base64Data] of Object.entries(fileAssets || {})) {
        await writeExportFile(
          path.join(assetsDir, filename),
          Uint8Array.from(atob(base64Data), (c) => c.charCodeAt(0))
        );
      }
    }
    await noteStore.retrieve();
    router.push(`/note/${noteData.id}`);
  } catch (error) {
    console.error('Error processing imported note:', error);
    throw error;
  }
}
