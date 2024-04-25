import { useStorage } from '@/composable/storage';

const storage = useStorage('settings');
const { path, ipcRenderer } = window.electron;

async function readFile(file) {
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

async function createFileName(file) {
  const dataDir = await storage.get('dataDir');
  const { ext, name } = path.parse(file.name);
  const fileName = `${name}${ext}`;
  const assetsPath = path.join(dataDir, 'file-assets');
  await ipcRenderer.callMain('fs:ensureDir', assetsPath);
  const destPath = path.join(assetsPath, fileName);
  return { destPath, fileName };
}

export async function saveFile(file, timestamp) {
  try {
    const contentUint8Array = await readFile(file);
    const { fileName, destPath } = await createFileName(file, timestamp);
    const relativePath = path.join('file-assets', fileName); // Construct relative path
    await ipcRenderer.callMain('fs:writeFile', {
      data: contentUint8Array,
      path: destPath,
    });
    return { fileName, relativePath }; // Return relative path instead of destPath
  } catch (error) {
    console.error(error);
    throw new Error('Failed to save file');
  }
}
