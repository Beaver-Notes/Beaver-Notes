// modules/protocol-manager.js
import { protocol, app } from 'electron';
import { join, normalize } from 'path';
import { ensureDir, existsSync } from 'fs-extra';
import store from '../store';

export class ProtocolManager {
  registerSchemes() {
    protocol.registerSchemesAsPrivileged([
      {
        scheme: 'file-assets',
        privileges: { standard: true, secure: true, stream: true },
      },
    ]);
  }

  async initialize() {
    await Promise.all([
      ensureDir(join(app.getPath('userData'), 'notes-assets')),
      ensureDir(join(app.getPath('userData'), 'file-assets')),
    ]);
    this.registerProtocols();
  }

  registerProtocols() {
    protocol.registerFileProtocol('assets', (request, callback) => {
      const url = request.url.substr(9);
      const dir = store.settings.get('dataDir');
      const imgPath = `${dir}/notes-assets/${url}`;
      callback({ path: normalize(imgPath) });
    });

    protocol.registerFileProtocol('file-assets', (request, callback) => {
      try {
        const url = request.url.substr('file-assets://'.length);
        const decodedUrl = decodeURIComponent(url);
        const dir = store.settings.get('dataDir');
        const filePath = join(dir, 'file-assets', decodedUrl);
        if (!existsSync(filePath)) {
          console.error(`File not found: ${filePath}`);
          return callback({ error: -6 });
        }
        const mimeType = 'application/octet-stream';
        callback({
          path: filePath,
          headers: {
            'Content-Type': mimeType,
            'Access-Control-Allow-Origin': '*',
          },
        });
      } catch (err) {
        console.error('Error handling file-assets protocol:', err);
        callback({ error: -2 });
      }
    });
  }
}
