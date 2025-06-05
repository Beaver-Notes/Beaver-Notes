// modules/handlers/filesystem-handlers.js
import { ipcMain } from 'electron-better-ipc';
import {
  copy,
  outputJson,
  readJson,
  ensureDir,
  pathExistsSync,
  remove,
  writeFileSync,
  readFileSync,
  readdir,
  statSync,
  mkdir,
  unlinkSync,
  pathExists,
} from 'fs-extra';
import path from 'path';
import store from '../../store';

export class FileSystemHandlers {
  register() {
    ipcMain.answerRenderer('fs:copy', ({ path, dest }) => copy(path, dest));
    ipcMain.answerRenderer('fs:output-json', ({ path, data }) =>
      outputJson(path, data)
    );
    ipcMain.answerRenderer('fs:read-json', (path) => readJson(path));
    ipcMain.answerRenderer('fs:ensureDir', (path) => ensureDir(path));
    ipcMain.answerRenderer('fs:pathExists', (path) => pathExistsSync(path));
    ipcMain.answerRenderer('fs:remove', (path) => remove(path));
    ipcMain.answerRenderer('fs:writeFile', ({ path, data }) =>
      writeFileSync(path, data)
    );
    ipcMain.answerRenderer('fs:readFile', (path) => readFileSync(path, 'utf8'));

    ipcMain.answerRenderer('fs:readdir', async (dirPath) => readdir(dirPath));
    ipcMain.answerRenderer('fs:stat', async (filePath) => statSync(filePath));
    ipcMain.answerRenderer('fs:mkdir', async (dirPath) => {
      await mkdir(dirPath, { recursive: true });
    });
    ipcMain.answerRenderer('fs:unlink', async (filePath) =>
      unlinkSync(filePath)
    );

    ipcMain.answerRenderer('fs:readData', this.handleReadData.bind(this));
    ipcMain.answerRenderer('fs:isFile', this.handleIsFile.bind(this));
  }

  handleReadData(filePath) {
    let actualPath = filePath;

    if (filePath.startsWith('assets://')) {
      const url = filePath.substr(9);
      const dir = store.settings.get('dataDir');
      actualPath = path.join(dir, 'notes-assets', url);
    } else if (filePath.startsWith('file-assets://')) {
      const url = filePath.substr(14);
      const dir = store.settings.get('dataDir');
      actualPath = path.join(dir, 'file-assets', url);
    }

    try {
      return readFileSync(actualPath, 'base64');
    } catch (error) {
      console.error('Error reading file:', error);
      return null;
    }
  }

  async handleIsFile(filePath) {
    try {
      const exists = await pathExists(filePath);
      return exists;
    } catch (error) {
      console.error('Error checking if file exists:', error);
      throw error;
    }
  }
}
