import { SHA256 } from 'crypto-es/lib/sha256';
import { isEncryptionEnabled } from '@/utils/encryption.js';
import { backend, path } from '@/lib/tauri-bridge';
import { getAppDirectory } from '@/lib/native/app';
import { base64ToUint8Array } from '@/utils/convert.js';

function sourceFileName(file) {
  if (typeof file === 'string') {
    return path.basename(file);
  }
  return file?.name || 'image';
}

async function readFile(file) {
  if (typeof file === 'string') {
    const base64 = await backend.invoke('fs:readData', file);
    return base64ToUint8Array(base64);
  }

  return new Promise((resolve, reject) => {
    const fileReader = new FileReader();
    fileReader.onload = (event) => {
      const result = event.target.result;
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

async function createFileName(file, id, timestamp) {
  const appDirectory = await getAppDirectory();
  const { ext, name } = path.parse(sourceFileName(file));
  const fileName = `${SHA256(name + timestamp).toString()}${ext}`;
  const assetsPath = path.join(appDirectory, 'notes-assets', id);
  await backend.invoke('fs:ensureDir', assetsPath);
  const destPath = path.join(assetsPath, fileName);
  return { destPath, fileName };
}

async function copyImage(file, id, timestamp) {
  const ts = timestamp || Date.now();
  const content = await readFile(file);
  const { fileName, destPath } = await createFileName(file, id, ts);
  await backend.invoke('fs:writeFile', {
    data: content,
    path: destPath,
    skipAssetEncryption: !isEncryptionEnabled(),
  });

  return { destPath, fileName };
}

export default copyImage;
export { copyImage as writeImageFile };
