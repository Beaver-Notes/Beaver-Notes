import { SHA256 } from 'crypto-es/lib/sha256';
import { isEncryptionEnabled } from '@/utils/encryption.js';
import { backend, path } from '@/lib/tauri-bridge';
import { getAppDirectory } from '@/lib/native/app';

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
  const appDirectory = await getAppDirectory();
  const { ext, name } = path.parse(filePath);
  const fileName = `${SHA256(name + timestamp).toString()}${ext}`;
  const assetsPath = path.join(appDirectory, 'notes-assets', id);
  await backend.invoke('fs:ensureDir', assetsPath);
  const destPath = path.join(assetsPath, fileName);
  return { destPath, fileName };
}

/**
 * @param {File} file
 * @param {string} id
 **/
async function copyImage(file, id, timestamp) {
  const content = await readFile(file);
  const { fileName, destPath } = await createFileName(file.name, id, timestamp);
  await backend.invoke('fs:writeFile', {
    data: content,
    path: destPath,
    skipAssetEncryption: !isEncryptionEnabled(),
  });

  return { destPath, fileName };
}

export default copyImage;
export { copyImage as writeImageFile };
