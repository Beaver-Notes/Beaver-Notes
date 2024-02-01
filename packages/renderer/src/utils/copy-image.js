import { SHA256 } from 'crypto-es/lib/sha256';
import { useStorage } from '@/composable/storage';

const storage = useStorage('settings');
const { path, ipcRenderer } = window.electron;

/**
 * @param {File} file
 * @returns {Promise<any>}
 **/
async function readFile(file) {
  return new Promise((resolve, reject) => {
    const fileReader = new FileReader();
    fileReader.onload = (event) => {
      const result = event.target.result;
      const uint8Array = new Uint8Array(result);

      // Ensure that the length is a multiple of 4
      const paddedLength = Math.ceil(uint8Array.length / 4) * 4;
      const paddedUint8Array = new Uint8Array(paddedLength);
      paddedUint8Array.set(uint8Array);

      // Create Uint32Array from padded Uint8Array
      const uint32Array = new Uint32Array(paddedUint8Array.buffer);

      resolve(uint32Array);
    };

    fileReader.onerror = (event) => {
      reject(event);
    };

    fileReader.readAsArrayBuffer(file);
  });
}

async function createFileName(filePath, id) {
  const dataDir = await storage.get('dataDir');
  const { ext, name } = path.parse(filePath);
  const fileName = SHA256(name).toString() + ext;
  const destPath = path.join(dataDir, 'notes-assets', id, fileName);
  return { destPath, fileName };
}

/**
 * @param {File} file
 * @param {string} id
 **/
export async function writeImageFile(file, id) {
  try {
    const content = await readFile(file);
    const { fileName, destPath } = await createFileName(file.name, id);
    await ipcRenderer.callMain('fs:writeFile', {
      data: content,
      path: destPath,
    });
    return { fileName, destPath };
  } catch (e) {
    console.error(e);
  }
}

export default async function (filePath, id) {
  try {
    const { fileName, destPath } = await createFileName(filePath, id);

    await ipcRenderer.callMain('fs:copy', {
      path: filePath,
      dest: destPath,
    });

    return { destPath, fileName };
  } catch (error) {
    console.error(error);
  }
}
