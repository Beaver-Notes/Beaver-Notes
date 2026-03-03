// modules/handlers/filesystem-handlers.js
import { ipcMain } from 'electron-better-ipc';
import fsExtra from 'fs-extra';
import {
  copy,
  outputJson,
  readJson,
  ensureDir,
  ensureDirSync,
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
import { assertPathAccess } from '../security/fs-access';
import {
  isLocalAssetPath,
  maybeDecryptAssetBufferForPath,
  maybeEncryptAssetBufferForPath,
} from '../security/app-asset-crypto';
import { resolveAssetPathFromAssetUri } from '../security/asset-paths';

const READ_WRITE_ACCESS = 4 | 2; // fs.constants.R_OK | fs.constants.W_OK

function toBuffer(data) {
  if (Buffer.isBuffer(data)) return data;
  if (data instanceof Uint8Array) return Buffer.from(data);
  if (ArrayBuffer.isView(data)) {
    return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  }
  if (data instanceof ArrayBuffer) return Buffer.from(data);
  if (typeof data === 'string') return Buffer.from(data, 'utf8');
  return Buffer.from(data);
}

export class FileSystemHandlers {
  register() {
    ipcMain.answerRenderer('fs:copy', ({ path: srcPath, dest }) => {
      assertPathAccess(srcPath, 'copy source');
      assertPathAccess(dest, 'copy destination');

      const sourceStat = statSync(srcPath);
      if (sourceStat.isDirectory()) {
        return copy(srcPath, dest);
      }

      let finalDest = dest;
      if (pathExistsSync(dest)) {
        try {
          if (statSync(dest).isDirectory()) {
            finalDest = path.join(dest, path.basename(srcPath));
          }
        } catch {
          // ignore and keep provided destination
        }
      }

      if (!isLocalAssetPath(finalDest)) {
        return copy(srcPath, dest);
      }

      ensureDirSync(path.dirname(finalDest));
      const raw = readFileSync(srcPath);
      const encrypted = maybeEncryptAssetBufferForPath(finalDest, raw);
      writeFileSync(finalDest, encrypted);
    });
    ipcMain.answerRenderer('fs:output-json', ({ path, data }) => {
      assertPathAccess(path, 'write json');
      return outputJson(path, data);
    });
    ipcMain.answerRenderer('fs:read-json', (path) => {
      assertPathAccess(path, 'read json');
      return readJson(path);
    });
    ipcMain.answerRenderer('fs:ensureDir', (path) => {
      assertPathAccess(path, 'ensure directory');
      return ensureDir(path);
    });
    ipcMain.answerRenderer('fs:pathExists', (path) => {
      assertPathAccess(path, 'check path exists');
      return pathExistsSync(path);
    });
    ipcMain.answerRenderer('fs:remove', (path) => {
      assertPathAccess(path, 'remove path');
      return remove(path);
    });
    ipcMain.answerRenderer(
      'fs:writeFile',
      ({ path: filePath, data, mode, skipAssetEncryption = false }) => {
        assertPathAccess(filePath, 'write file');
        const payload = maybeEncryptAssetBufferForPath(filePath, toBuffer(data), {
          skip: skipAssetEncryption,
        });
        if (mode !== undefined) {
          writeFileSync(filePath, payload, { mode });
        } else {
          writeFileSync(filePath, payload);
        }
      },
    );

    ipcMain.answerRenderer('fs:mkdir', async ({ path: dirPath, mode }) => {
      assertPathAccess(dirPath, 'mkdir');
      if (mode !== undefined) {
        await mkdir(dirPath, { recursive: true, mode });
      } else {
        await mkdir(dirPath, { recursive: true });
      }
    });

    ipcMain.answerRenderer('fs:readFile', (path) => {
      assertPathAccess(path, 'read file');
      return readFileSync(path, 'utf8');
    });

    ipcMain.answerRenderer('fs:readdir', async (dirPath) => {
      assertPathAccess(dirPath, 'read directory');
      return readdir(dirPath);
    });
    ipcMain.answerRenderer('fs:stat', async (filePath) => {
      assertPathAccess(filePath, 'stat');
      return statSync(filePath);
    });
    ipcMain.answerRenderer('fs:unlink', async (filePath) => {
      assertPathAccess(filePath, 'unlink');
      return unlinkSync(filePath);
    });

    ipcMain.answerRenderer('fs:readData', this.handleReadData.bind(this));
    ipcMain.answerRenderer('fs:isFile', this.handleIsFile.bind(this));

    /**
     * fs:access — sandbox-safe replacement for the preload's direct
     * fs/promises access() call. Applies assertPathAccess before checking
     * R_OK | W_OK so the filesystem permission layer is always enforced.
     */
    ipcMain.answerRenderer('fs:access', (dir) => {
      assertPathAccess(dir, 'access check');
      return new Promise((resolve, reject) => {
        fsExtra.access(dir, READ_WRITE_ACCESS, (err) => {
          if (err) reject(err);
          else resolve(true);
        });
      });
    });

    /**
     * path:* — registered with ipcMain.on + event.returnValue so they respond
     * to sendSync calls from the preload. Pure string utilities; no permission
     * check needed since no filesystem access occurs.
     */
    ipcMain.on('path:join', (event, segments) => {
      event.returnValue = path.join(...segments);
    });
    ipcMain.on('path:dirname', (event, p) => {
      event.returnValue = path.dirname(p);
    });
    ipcMain.on('path:basename', (event, p) => {
      event.returnValue = path.basename(p);
    });
    ipcMain.on('path:extname', (event, p) => {
      event.returnValue = path.extname(p);
    });
  }

  handleReadData(filePath) {
    let actualPath = filePath;
    try {
      actualPath = resolveAssetPathFromAssetUri(filePath);
    } catch (error) {
      console.error('Error resolving asset URI:', error);
      return null;
    }

    try {
      assertPathAccess(actualPath, 'read data');
      const raw = readFileSync(actualPath);
      const plain = maybeDecryptAssetBufferForPath(actualPath, raw);
      return plain.toString('base64');
    } catch (error) {
      console.error('Error reading file:', error);
      return null;
    }
  }

  async handleIsFile(filePath) {
    try {
      assertPathAccess(filePath, 'is file');
      const exists = await pathExists(filePath);
      return exists;
    } catch (error) {
      console.error('Error checking if file exists:', error);
      throw error;
    }
  }
}
