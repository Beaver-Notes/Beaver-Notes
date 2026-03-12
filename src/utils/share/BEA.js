import { useStorage } from '@/composable/storage';
import { useDialog } from '@/composable/dialog';
import { useNoteStore } from '../../store/note';
import { useLabelStore } from '@/store/label';
import { useI18nStore } from '@/store/i18n';
import { backend, path } from '@/lib/tauri-bridge';

function getShareTranslations() {
  try {
    return useI18nStore().messages?.share || {};
  } catch {
    return {};
  }
}

function interpolate(template, params = {}) {
  let out = template;
  for (const [key, value] of Object.entries(params)) {
    out = out.split(`{${key}}`).join(String(value));
  }
  return out;
}

function showDialogAlert(body) {
  const i18n = useI18nStore();
  const dialog = useDialog();
  dialog.alert({
    title: i18n.messages?.settings?.alertTitle || 'Alert',
    body,
    okText: i18n.messages?.dialog?.close || 'Close',
  });
}

async function encodeAssets(sourcePath) {
  const assets = {};

  try {
    const files = await backend.invoke('fs:readdir', sourcePath);

    for (const file of files) {
      const filePath = path.join(sourcePath, file);

      const base64Data = await backend.invoke('fs:readData', filePath);

      if (!base64Data) {
        console.warn(`File ${file} could not be read or is empty.`);
        assets[file] = '';
        continue;
      }

      assets[file] = base64Data;
    }
  } catch (error) {
    console.error(`Error reading assets from ${sourcePath}:, error`);
  }

  return assets;
}

export async function exportBEA(noteId, noteTitle) {
  const storage = useStorage();
  const share = getShareTranslations();
  try {
    const { canceled, filePaths } = await backend.invoke('dialog:open', {
      title: share.exportNoteDialogTitle || 'Export note',
      properties: ['openDirectory'],
    });

    if (canceled) return;

    const allNotes = await storage.store();
    const notesArray = Array.isArray(allNotes)
      ? allNotes
      : Object.values(allNotes.notes || {});

    const noteToExport = notesArray.find((note) => note.id === noteId);

    if (!noteToExport) {
      showDialogAlert(
        interpolate(
          share.noteWithIdNotFound || 'Note with ID {id} not found.',
          { id: noteId }
        )
      );
      return;
    }

    const dataDir = await storage.get('dataDir', '', 'settings');
    const noteAssetsSource = path.join(dataDir, 'notes-assets', noteId);
    const fileAssetsSource = path.join(dataDir, 'file-assets', noteId);

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
    const outputPath = path.join(filePaths[0], outputFileName);

    await backend.invoke('fs:output-json', {
      path: outputPath,
      data: exportedData,
    });

    showDialogAlert(
      interpolate(
        share.noteExportedToPath || 'Note "{title}" exported to "{path}".',
        {
          title: noteToExport.title,
          path: outputPath,
        }
      )
    );
  } catch (error) {
    console.error(error);
  }
}

export async function importBEA(filePath, router, store) {
  const share = getShareTranslations();
  try {
    const fileContent = await backend.invoke('fs:read-json', filePath);

    if (!fileContent || !fileContent.data) {
      throw new Error(
        share.invalidFileFormat || 'Invalid file format or empty file.'
      );
    }

    const fileData = fileContent.data;

    if (
      !fileData.id ||
      !fileData.title ||
      !fileData.content ||
      typeof fileData.content !== 'object' ||
      !fileData.assets
    ) {
      throw new Error(
        share.missingEssentialFields ||
          'Missing essential note fields in the imported file.'
      );
    }

    const { notesAssets, fileAssets } = fileData.assets;
    if (typeof notesAssets !== 'object' || typeof fileAssets !== 'object') {
      throw new Error(
        share.invalidAssetsStructure ||
          'Invalid assets structure in the imported note.'
      );
    }

    await processImportedNote(fileData, router, store);

    return true;
  } catch (error) {
    console.error('Error importing note:', error);
    return { success: false, message: error.message };
  }
}

async function processImportedNote(noteData, router) {
  const storage = useStorage();
  const noteStore = useNoteStore();
  const labelStore = useLabelStore();
  try {
    const dataDir = await storage.get('dataDir', '', 'settings');

    for (const label of noteData.labels || []) {
      if (!labelStore.data.includes(label)) {
        await labelStore.add(label);
      }
    }

    const notePayload = {
      id: noteData.id,
      title: noteData.title,
      content: noteData.content,
      labels: noteData.labels || [],
    };
    if (noteStore.data[noteData.id]) {
      await noteStore.update(noteData.id, notePayload);
    } else {
      await noteStore.add(notePayload);
    }

    if (noteData.lockedNotes) {
      const existingLockedNotes = JSON.parse(
        localStorage.getItem('lockedNotes') || '{}'
      );
      const mergedLockedNotes = {
        ...existingLockedNotes,
        ...noteData.lockedNotes,
      };
      localStorage.setItem('lockedNotes', JSON.stringify(mergedLockedNotes));
    }

    if (noteData.assets) {
      const { notesAssets, fileAssets } = noteData.assets;

      await backend.invoke('fs:mkdir', {
        path: path.join(dataDir, 'notes-assets', noteData.id),
      });
      await backend.invoke('fs:mkdir', {
        path: path.join(dataDir, 'file-assets', noteData.id),
      });

      for (const [filename, base64Data] of Object.entries(notesAssets || {})) {
        const byteArray = Uint8Array.from(atob(base64Data), (char) =>
          char.charCodeAt(0)
        );
        await backend.invoke('fs:writeFile', {
          path: path.join(dataDir, 'notes-assets', noteData.id, filename),
          data: byteArray,
        });
      }

      for (const [filename, base64Data] of Object.entries(fileAssets || {})) {
        const byteArray = Uint8Array.from(atob(base64Data), (char) =>
          char.charCodeAt(0)
        );
        await backend.invoke('fs:writeFile', {
          path: path.join(dataDir, 'file-assets', noteData.id, filename),
          data: byteArray,
        });
      }
    }

    await noteStore.retrieve();
    router.push(`/note/${noteData.id}`);
  } catch (error) {
    console.error('Error processing imported note:', error);
    throw error;
  }
}
