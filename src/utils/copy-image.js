import { SHA256 } from 'crypto-es/lib/sha256';
import { useStorage } from '@/composable/storage';
import { isAppEncryptionEnabled } from '@/utils/appCrypto';
import { backend, path } from '@/lib/tauri-bridge';

const storage = useStorage('settings');

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

async function createFileName(filePath, id, timestamp) {
  const dataDir = await storage.get('dataDir');
  const { ext, name } = path.parse(filePath);
  const fileName = `${SHA256(name + timestamp).toString()}${ext}`;
  const assetsPath = path.join(dataDir, 'notes-assets', id);
  await backend.invoke('fs:ensureDir', assetsPath);
  const destPath = path.join(assetsPath, fileName);
  return { destPath, fileName };
}

/**
 * @param {File} file
 * @param {string} id
 **/
export async function writeImageFile(file, id, timestamp) {
  const content = await readFile(file);
  const { fileName, destPath } = await createFileName(file.name, id, timestamp);
  await backend.invoke('fs:writeFile', {
    data: content,
    path: destPath,
    skipAssetEncryption: !isAppEncryptionEnabled(),
  });
  return { fileName, destPath };
}

export default async function (filePath, id, timestamp) {
  const { fileName, destPath } = await createFileName(filePath, id, timestamp);

  await backend.invoke('fs:copy', {
    path: filePath,
    dest: destPath,
    skipAssetEncryption: !isAppEncryptionEnabled(),
  });

  return { destPath, fileName };
}
