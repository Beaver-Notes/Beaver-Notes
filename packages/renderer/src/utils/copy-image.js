import { SHA256 } from 'crypto-es/lib/sha256';
import { useStorage } from '@/composable/storage';

const storage = useStorage('settings');
const { path, ipcRenderer } = window.electron;

export default async function (filePath, id) {
  try {
    const dataDir = await storage.get('dataDir');
    const { ext, name } = path.parse(filePath);
    const fileName = SHA256(name).toString() + ext;
    const destPath = path.join(dataDir, 'notes-assets', id, fileName);

    await ipcRenderer.callMain('fs:copy', {
      path: filePath,
      dest: destPath,
    });

    return { destPath, fileName };
  } catch (error) {
    console.error(error);
  }
}
