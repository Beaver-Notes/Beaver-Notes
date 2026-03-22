import { useStorage } from '@/composable/storage';
import { isAppEncryptionEnabled } from '@/utils/appCrypto';
import { backend, path } from '@/lib/tauri-bridge';

const storage = useStorage('settings');

function base64ToUint8Array(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

function sourceFileName(file) {
  if (typeof file === 'string') {
    return path.basename(file);
  }
  return file?.name || 'file';
}

async function readFile(file) {
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

async function createFileName(file, id) {
  const dataDir = await storage.get('dataDir');
  const { ext, name } = path.parse(sourceFileName(file));
  const fileName = `${name}${ext}`;
  const assetsPath = path.join(dataDir, 'file-assets', id);
  await backend.invoke('fs:ensureDir', assetsPath);
  const destPath = path.join(assetsPath, fileName);
  return { destPath, fileName };
}

export async function saveFile(file, id) {
  try {
    const contentUint8Array = await readFile(file);
    const { fileName, destPath } = await createFileName(file, id);
    const relativePath = `file-assets://${id}/${fileName}`; // Construct relative path
    await backend.invoke('fs:writeFile', {
      data: contentUint8Array,
      path: destPath,
      skipAssetEncryption: !isAppEncryptionEnabled(),
    });
    return { fileName, relativePath }; // Return relative path instead of destPath
  } catch (error) {
    console.error(error);
    throw new Error('Failed to save file');
  }
}
