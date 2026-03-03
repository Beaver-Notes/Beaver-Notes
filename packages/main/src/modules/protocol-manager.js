// modules/protocol-manager.js
import { protocol, app } from 'electron';
import { createHash } from 'crypto';
import { extname, join, normalize } from 'path';
import {
  ensureDir,
  ensureDirSync,
  existsSync,
  readdirSync,
  readFileSync,
  removeSync,
  statSync,
  writeFileSync,
} from 'fs-extra';
import {
  isEncryptedAssetBuffer,
  maybeDecryptAssetBufferForPath,
} from './security/app-asset-crypto';
import { resolveAssetPathFromProtocolUrl } from './security/asset-paths';

export class ProtocolManager {
  constructor() {
    this.decryptedAssetCache = new Map();
    this.decryptedAssetCacheDir = join(
      app.getPath('temp'),
      'beaver-notes-asset-cache',
    );
    this._pruneDecryptedAssetCache();
    app.on('before-quit', () => {
      this._clearDecryptedAssetCache();
    });
  }

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
      try {
        const imgPath = normalize(
          resolveAssetPathFromProtocolUrl(request.url, 'assets'),
        );
        if (!existsSync(imgPath)) return callback({ error: -6 });
        callback({ path: this._getDecryptedAssetPath(imgPath) });
      } catch (err) {
        console.error('Error handling assets protocol:', err);
        callback({ error: -2 });
      }
    });

    protocol.registerFileProtocol('file-assets', (request, callback) => {
      try {
        const normalizedPath = normalize(
          resolveAssetPathFromProtocolUrl(request.url, 'file-assets'),
        );
        if (!existsSync(normalizedPath)) {
          console.error(`File not found: ${normalizedPath}`);
          return callback({ error: -6 });
        }
        const mimeType = 'application/octet-stream';
        callback({
          path: this._getDecryptedAssetPath(normalizedPath),
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

  _getDecryptedAssetPath(filePath) {
    const raw = readFileSync(filePath);
    if (!isEncryptedAssetBuffer(raw)) return filePath;

    const stat = statSync(filePath);
    const cacheKey = `${filePath}:${stat.mtimeMs}:${stat.size}`;
    const cacheHit = this.decryptedAssetCache.get(filePath);
    if (cacheHit?.key === cacheKey && existsSync(cacheHit.path)) {
      return cacheHit.path;
    }

    const decrypted = maybeDecryptAssetBufferForPath(filePath, raw);
    const ext = extname(filePath) || '.bin';
    const hashed = createHash('sha256').update(cacheKey).digest('hex');
    const cachePath = join(this.decryptedAssetCacheDir, `${hashed}${ext}`);

    ensureDirSync(this.decryptedAssetCacheDir);
    writeFileSync(cachePath, decrypted, { mode: 0o600 });
    this.decryptedAssetCache.set(filePath, { key: cacheKey, path: cachePath });
    this._pruneDecryptedAssetCache();

    return cachePath;
  }

  _clearDecryptedAssetCache() {
    try {
      removeSync(this.decryptedAssetCacheDir);
    } catch {
      // ignore cleanup failures
    } finally {
      this.decryptedAssetCache.clear();
    }
  }

  _pruneDecryptedAssetCache() {
    const MAX_CACHE_FILES = 300;
    const MAX_CACHE_AGE_MS = 6 * 60 * 60 * 1000;
    const now = Date.now();

    try {
      ensureDirSync(this.decryptedAssetCacheDir);
      const entries = readdirSync(this.decryptedAssetCacheDir)
        .map((name) => {
          const fullPath = join(this.decryptedAssetCacheDir, name);
          try {
            const stat = statSync(fullPath);
            if (!stat.isFile()) return null;
            return { fullPath, mtimeMs: stat.mtimeMs };
          } catch {
            return null;
          }
        })
        .filter(Boolean)
        .sort((a, b) => b.mtimeMs - a.mtimeMs);

      entries.forEach((entry, index) => {
        const tooOld = now - entry.mtimeMs > MAX_CACHE_AGE_MS;
        const overLimit = index >= MAX_CACHE_FILES;
        if (!tooOld && !overLimit) return;

        try {
          removeSync(entry.fullPath);
        } catch {
          // ignore single-file cleanup failures
        }
      });
    } catch {
      // ignore cache prune failures
    }
  }
}
