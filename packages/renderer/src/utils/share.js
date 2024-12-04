import { shallowReactive } from 'vue';
import { AES } from 'crypto-es/lib/aes';
import { useStorage } from '@/composable/storage';
import { useDialog } from '@/composable/dialog';
import { Utf8 } from 'crypto-es/lib/core';

const { ipcRenderer, path } = window.electron;
const state = shallowReactive({
  dataDir: '',
  password: '',
  fontSize: '16',
  withPassword: false,
  lastUpdated: null,
});
export async function exportNoteById(noteId, noteTitle) {
  const storage = useStorage();
  try {
    // Open dialog to select export directory
    const { canceled, filePaths } = await ipcRenderer.callMain('dialog:open', {
      title: 'Export note',
      properties: ['openDirectory'],
    });

    if (canceled) return;

    // Fetch the notes data from storage
    const allNotes = await storage.store(); // Get all notes data

    // Assuming allNotes is an object, you may need to extract the notes array
    const notesArray = Array.isArray(allNotes)
      ? allNotes
      : Object.values(allNotes.notes || {});

    // Find the specific note by ID
    const noteToExport = notesArray.find((note) => note.id === noteId);

    if (!noteToExport) {
      alert(`Note with ID ${noteId} not found.`);
      return;
    }

    // Prepare the data for export (only necessary info for the note)
    let data = {
      id: noteToExport.id,
      title: noteToExport.title,
      content: noteToExport.content,
      lockedNotes: JSON.parse(localStorage.getItem('lockedNotes')),
    };

    // Fetch and encode assets from the specific directories
    const dataDir = await storage.get('dataDir', '', 'settings');
    const noteAssetsSource = path.join(dataDir, 'notes-assets', noteId); // Path to note-specific assets
    const fileAssetsSource = path.join(dataDir, 'file-assets', noteId); // Path to file-specific assets

    const assets = {
      notesAssets: await encodeAssets(noteAssetsSource),
      fileAssets: await encodeAssets(fileAssetsSource),
    };

    // Add assets to the data object
    data.assets = assets;

    // Encrypt data if password is required
    if (state.withPassword) {
      data = AES.encrypt(JSON.stringify(data), state.password).toString();
    } else {
      data = JSON.stringify(data); // Convert to string for saving
    }

    // Create the output file name and path
    const outputFileName = `${noteTitle}.bea`; // Custom .bea file format
    const outputPath = path.join(filePaths[0], outputFileName);

    // Save the note data to a single .bea file
    await ipcRenderer.callMain('fs:output-json', {
      path: outputPath,
      data: { data },
    });

    alert(`Note "${noteToExport.title}" exported to "${outputPath}".`);

    // Clear sensitive data
    state.withPassword = false;
    state.password = '';
  } catch (error) {
    console.error(error);
  }
}

// Function to encode assets from a directory
async function encodeAssets(sourcePath) {
  const assets = {};

  try {
    // List all files in the directory
    const files = await ipcRenderer.callMain('fs:readdir', sourcePath);

    console.log(files);

    for (const file of files) {
      const filePath = path.join(sourcePath, file);
      const fileBuffer = await ipcRenderer.callMain('fs:readFile', filePath); // Read the file
      const base64Data = btoa(
        String.fromCharCode(...new Uint8Array(fileBuffer))
      ); // Convert to base64

      // Store encoded asset in an object with the file name as the key
      assets[file] = base64Data;
    }
  } catch (error) {
    console.error(`Error reading assets from ${sourcePath}:`, error);
  }

  return assets; // Return the encoded assets
}

export async function importNoteFromBea(filePath) {
  const dialog = useDialog();

  try {
    // Read the .bea file
    const fileContent = await ipcRenderer.callMain('fs:read-json', filePath);
    if (!fileContent || !fileContent.data) {
      throw new Error('Invalid file format');
    }

    let noteData;
    // Try parsing the data field directly first
    try {
      noteData = JSON.parse(fileContent.data);
    } catch (e) {
      // If parsing fails, it might be encrypted
      return new Promise((resolve, reject) => {
        dialog.prompt({
          title: 'Import Protected Note',
          body: 'This note is password protected. Please enter the password to import.',
          okText: 'Import',
          cancelText: 'Cancel',
          placeholder: 'Password',
          onConfirm: async (password) => {
            try {
              // Decrypt the data
              const bytes = AES.decrypt(fileContent.data, password);
              const decrypted = bytes.toString(Utf8);
              noteData = JSON.parse(decrypted);
              await processImportedNote(noteData);
              resolve(true);
              return true;
            } catch (error) {
              alert('Invalid password or corrupted file.');
              reject(error);
              return false;
            }
          },
          onCancel: () => {
            resolve(false);
          },
        });
      });
    }

    // If we got here, the data wasn't encrypted
    await processImportedNote(noteData);
    return true;
  } catch (error) {
    console.error('Error importing note:', error);
    alert(
      'Failed to import note. The file may be corrupted or in an invalid format.'
    );
    return false;
  }
}

async function processImportedNote(noteData) {
  const storage = useStorage();
  try {
    // Get current storage data
    const currentNotes = await storage.get('notes', {});
    const dataDir = await storage.get('dataDir', '', 'settings');

    // Update notes storage
    const updatedNotes = {
      ...currentNotes,
      [noteData.id]: {
        id: noteData.id,
        title: noteData.title,
        content: noteData.content,
      },
    };
    await storage.set('notes', updatedNotes);

    // Update locked notes if present and not null
    if (noteData.lockedNotes) {
      localStorage.setItem('lockedNotes', JSON.stringify(noteData.lockedNotes));
    }

    // Process assets if present
    if (noteData.assets) {
      // Create directories if they don't exist
      await ipcRenderer.callMain(
        'fs:mkdir',
        path.join(dataDir, 'notes-assets', noteData.id)
      );
      await ipcRenderer.callMain(
        'fs:mkdir',
        path.join(dataDir, 'file-assets', noteData.id)
      );

      // Process notes assets
      for (const [filename, base64Data] of Object.entries(
        noteData.assets.notesAssets || {}
      )) {
        const binaryString = atob(base64Data);
        const byteArray = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          byteArray[i] = binaryString.charCodeAt(i);
        }
        await ipcRenderer.callMain('fs:writeFile', {
          path: path.join(dataDir, 'notes-assets', noteData.id, filename),
          data: byteArray.buffer,
        });
      }

      // Process file assets
      for (const [filename, base64Data] of Object.entries(
        noteData.assets.fileAssets || {}
      )) {
        const binaryString = atob(base64Data);
        const byteArray = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          byteArray[i] = binaryString.charCodeAt(i);
        }
        await ipcRenderer.callMain('fs:writeFile', {
          path: path.join(dataDir, 'file-assets', noteData.id, filename),
          data: byteArray.buffer,
        });
      }
    }

    alert(`Note "${noteData.title}" imported successfully.`);
  } catch (error) {
    console.error('Error processing imported note:', error);
    throw error;
  }
}
