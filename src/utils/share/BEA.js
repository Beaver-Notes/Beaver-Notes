import { useStorage } from '@/composable/storage';
import { useNoteStore } from '../../store/note';
import { useLabelStore } from '@/store/label';
import { useI18nStore } from '@/store/i18n';
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
  const storage = useStorage();
  const share = getShareTranslations();
  try {
    const rootDir = await chooseRootExportDir(
      share.exportNoteDialogTitle || 'Export note'
    );
    if (!rootDir) return;
    const allNotes = await storage.store();
    const notesArray = Array.isArray(allNotes)
      ? allNotes
      : Object.values(allNotes.notes || {});
    const noteToExport = notesArray.find((note) => note.id === noteId);
    if (!noteToExport) {
      console.warn(`Note with ID ${noteId} not found for export.`);
      return;
    }
    const appDirectory = await getAppDirectory();
    const noteAssetsSource = path.join(appDirectory, 'notes-assets', noteId);
    const fileAssetsSource = path.join(appDirectory, 'file-assets', noteId);
    const assets = {
      notesAssets: await encodeAssets(noteAssetsSource),
      fileAssets: await encodeAssets(fileAssetsSource),
    };
    const exportedData = {
      data: {
        id: noteId,
        title: noteToExport.title,
        content: noteToExport.content,
        lockedNotes: JSON.parse(localStorage.getItem('lockedNotes')) || {},
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
    await processImportedNote(fileData, router, store, folderId);
    return true;
  } catch (error) {
    console.error('Error importing note:', error);
    return { success: false, message: errorMessage(error) };
  }
}

async function processImportedNote(noteData, router, folderId = null) {
  const _storage = useStorage();
  const noteStore = useNoteStore();
  const labelStore = useLabelStore();
  try {
    const appDirectory = await getAppDirectory();
    for (const label of noteData.labels || []) {
      if (!labelStore.data.includes(label)) await labelStore.add(label);
    }
    const notePayload = {
      id: noteData.id,
      title: noteData.title,
      content: sanitizeNoteContent(noteData.content),
      labels: noteData.labels || [],
      folderId,
    };
    if (noteStore.data[noteData.id])
      await noteStore.update(noteData.id, notePayload);
    else await noteStore.add(notePayload);
    if (noteData.lockedNotes) {
      const existing = JSON.parse(localStorage.getItem('lockedNotes') || '{}');
      localStorage.setItem(
        'lockedNotes',
        JSON.stringify({ ...existing, ...noteData.lockedNotes })
      );
    }
    if (noteData.assets) {
      const { notesAssets, fileAssets } = noteData.assets;
      await ensureExportDir(
        path.join(appDirectory, 'notes-assets', noteData.id)
      );
      await ensureExportDir(
        path.join(appDirectory, 'file-assets', noteData.id)
      );
      for (const [filename, base64Data] of Object.entries(notesAssets || {})) {
        await writeExportFile(
          path.join(appDirectory, 'notes-assets', noteData.id, filename),
          Uint8Array.from(atob(base64Data), (c) => c.charCodeAt(0))
        );
      }
      for (const [filename, base64Data] of Object.entries(fileAssets || {})) {
        await writeExportFile(
          path.join(appDirectory, 'file-assets', noteData.id, filename),
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
