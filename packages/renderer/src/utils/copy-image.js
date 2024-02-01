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
    const fileReader = new FileReader(file);
    fileReader.onload = (event) => {
      /* @type {ArrayBuffer} */
      const result = event.target.result;

      // Pad the byte length to be a multiple of 4
      const paddedLength = Math.ceil(result.byteLength / 4) * 4;
      const paddedBuffer = new ArrayBuffer(paddedLength);
      const paddedView = new Uint8Array(paddedBuffer);
      paddedView.set(new Uint8Array(result));

      const uint32View = new Uint32Array(paddedBuffer);
      resolve(uint32View);
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
