import { useStorage } from '@/composable/storage';
const { ipcRenderer, path } = window.electron;

async function encodeAssets(sourcePath) {
  const assets = {};

  try {
    const files = await ipcRenderer.callMain('fs:readdir', sourcePath);

    for (const file of files) {
      const filePath = path.join(sourcePath, file);

      const base64Data = await ipcRenderer.callMain('fs:readData', filePath);

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
  try {
    const { canceled, filePaths } = await ipcRenderer.callMain('dialog:open', {
      title: 'Export note',
      properties: ['openDirectory'],
    });

    if (canceled) return;

    const allNotes = await storage.store();
    const notesArray = Array.isArray(allNotes)
      ? allNotes
      : Object.values(allNotes.notes || {});

    const noteToExport = notesArray.find((note) => note.id === noteId);

    if (!noteToExport) {
      alert(`Note with ID ${noteId} not found.`);
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

    await ipcRenderer.callMain('fs:output-json', {
      path: outputPath,
      data: exportedData,
    });

    alert(`Note "${noteToExport.title}" exported to "${outputPath}".`);
  } catch (error) {
    console.error(error);
  }
}

export async function importBEA(filePath, router, store) {
  try {
    const fileContent = await ipcRenderer.callMain('fs:read-json', filePath);

    if (!fileContent || !fileContent.data) {
      throw new Error('Invalid file format or empty file.');
    }

    const fileData = fileContent.data;

    if (
      !fileData.id ||
      !fileData.title ||
      !fileData.content ||
      typeof fileData.content !== 'object' ||
      !fileData.assets
    ) {
      throw new Error('Missing essential note fields in the imported file.');
    }

    const { notesAssets, fileAssets } = fileData.assets;
    if (typeof notesAssets !== 'object' || typeof fileAssets !== 'object') {
      throw new Error('Invalid assets structure in the imported note.');
    }

    await processImportedNote(fileData, router, store);

    return true;
  } catch (error) {
    console.error('Error importing note:', error);
    alert(
      'Failed to import note. Please ensure the file is not corrupted and is in the correct format.'
    );
    return false;
  }
}

async function processImportedNote(noteData, router, store) {
  const storage = useStorage();
  try {
    const currentNotes = await storage.get('notes', {});
    const dataDir = await storage.get('dataDir', '', 'settings');

    const updatedNotes = {
      ...currentNotes,
      [noteData.id]: {
        id: noteData.id,
        title: noteData.title,
        content: noteData.content,
        labels: noteData.labels || [],
      },
    };
    await storage.set('notes', updatedNotes);

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

      await ipcRenderer.callMain(
        'fs:mkdir',
        path.join(dataDir, 'notes-assets', noteData.id)
      );
      await ipcRenderer.callMain(
        'fs:mkdir',
        path.join(dataDir, 'file-assets', noteData.id)
      );

      for (const [filename, base64Data] of Object.entries(notesAssets || {})) {
        const byteArray = Uint8Array.from(atob(base64Data), (char) =>
          char.charCodeAt(0)
        );
        await ipcRenderer.callMain('fs:writeFile', {
          path: path.join(dataDir, 'notes-assets', noteData.id, filename),
          data: byteArray,
        });
      }

      for (const [filename, base64Data] of Object.entries(fileAssets || {})) {
        const byteArray = Uint8Array.from(atob(base64Data), (char) =>
          char.charCodeAt(0)
        );
        await ipcRenderer.callMain('fs:writeFile', {
          path: path.join(dataDir, 'file-assets', noteData.id, filename),
          data: byteArray,
        });
      }
    }

    store.retrieve('notes', updatedNotes);
    router.push(`/note/${noteData.id}`);
  } catch (error) {
    console.error('Error processing imported note:', error);
    throw error;
  }
}
