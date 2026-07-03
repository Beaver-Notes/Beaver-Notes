
import { isEncryptionEnabled } from '@/utils/crypto/encryption.js';
import { backend, path } from '@/lib/tauri-bridge';
import { getAppDirectory } from '@/lib/native/app';
import { base64ToUint8Array } from '@/utils/helpers/index.js';

function sourceFileName(file) {
  if (typeof file === 'string') {
    return path.basename(file);
  }
  return file?.name || 'file';
}

async function readFileAsBytes(file) {
  if (typeof file === 'string') {
    const base64 = await backend.invoke('fs:readData', file);
    return base64ToUint8Array(base64);
  }

  return new Promise((resolve, reject) => {
    const fileReader = new FileReader();
    fileReader.onload = () => {
      resolve(new Uint8Array(fileReader.result));
    };
    fileReader.onerror = (error) => {
      reject(error);
    };
    fileReader.readAsArrayBuffer(file);
  });
}

async function readFileAsUint32(file) {
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

// ─── Document / file saving ──────────────────────────────────────────────────

async function createFileDestination(file, id) {
  const appDirectory = await getAppDirectory();
  const { ext, name } = path.parse(sourceFileName(file));
  const fileName = `${name}${ext}`;
  const assetsPath = path.join(appDirectory, 'file-assets', id);
  await backend.invoke('fs:ensureDir', assetsPath);
  const destPath = path.join(assetsPath, fileName);
  return { destPath, fileName };
}

export async function saveFile(file, id) {
  try {
    const contentUint8Array = await readFileAsBytes(file);
    const { fileName, destPath } = await createFileDestination(file, id);
    const relativePath = `file-assets://${id}/${fileName}`;
    await backend.invoke('fs:writeFile', {
      data: contentUint8Array,
      path: destPath,
      skipAssetEncryption: !isEncryptionEnabled(),
    });
    return { fileName, relativePath };
  } catch (error) {
    console.error(error);
    throw new Error('Failed to save file');
  }
}

// ─── Image saving ────────────────────────────────────────────────────────────

async function sha256Hex(input) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function createImageDestination(file, id, timestamp) {
  const appDirectory = await getAppDirectory();
  const { ext, name } = path.parse(sourceFileName(file));
  const fileName = `${await sha256Hex(name + timestamp)}${ext}`;
  const assetsPath = path.join(appDirectory, 'notes-assets', id);
  await backend.invoke('fs:ensureDir', assetsPath);
  const destPath = path.join(assetsPath, fileName);
  return { destPath, fileName };
}

async function copyImage(file, id, timestamp) {
  const ts = timestamp || Date.now();
  const content = await readFileAsUint32(file);
  const { fileName, destPath } = await createImageDestination(file, id, ts);
  await backend.invoke('fs:writeFile', {
    data: content,
    path: destPath,
    skipAssetEncryption: !isEncryptionEnabled(),
  });

  return { destPath, fileName };
}

export default copyImage;
export { copyImage as writeImageFile };
