import { safeStorage } from 'electron';
import Store from 'electron-store';
import {
  createCipheriv,
  createDecipheriv,
  pbkdf2Sync,
  randomBytes,
} from 'crypto';
import path from 'path';
import { pathExistsSync, readFileSync } from 'fs-extra';
import store from '../../store';

const authStore = new Store({ name: 'auth' });

const PBKDF2_ITERATIONS = 100_000;
const ASSET_MAGIC = Buffer.from('BNA1');
let _transientPassphrase = '';

let _keyCache = {
  dataDir: '',
  saltHex: '',
  blob: '',
  key: null,
};

function _isPathInside(baseDir, targetPath) {
  const rel = path.relative(path.resolve(baseDir), path.resolve(targetPath));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function _assetRoots(dataDir) {
  return [
    path.join(dataDir, 'notes-assets'),
    path.join(dataDir, 'file-assets'),
  ];
}

function _getDataDir() {
  return store.settings.get('dataDir');
}

function _loadAppAssetKey() {
  try {
    const dataDir = _getDataDir();
    if (!dataDir) return null;

    const blob = authStore.get('blobs.appPassphraseBlob', '');
    const saltPath = path.join(dataDir, 'app-crypto', 'salt');
    if (!pathExistsSync(saltPath)) return null;
    const saltHex = readFileSync(saltPath, 'utf8')?.trim();
    if (!saltHex) return null;

    if (blob) {
      if (
        _keyCache.key &&
        _keyCache.dataDir === dataDir &&
        _keyCache.saltHex === saltHex &&
        _keyCache.blob === blob
      ) {
        return _keyCache.key;
      }

      const passphrase = safeStorage.decryptString(Buffer.from(blob, 'base64'));
      const key = pbkdf2Sync(
        passphrase,
        Buffer.from(saltHex, 'hex'),
        PBKDF2_ITERATIONS,
        32,
        'sha256',
      );

      _keyCache = {
        dataDir,
        saltHex,
        blob,
        key,
      };
      return key;
    }
  } catch (error) {
    // Fall through to transient passphrase path below.
  }

  try {
    if (!_transientPassphrase) return null;
    const dataDir = _getDataDir();
    if (!dataDir) return null;
    const saltPath = path.join(dataDir, 'app-crypto', 'salt');
    if (!pathExistsSync(saltPath)) return null;
    const saltHex = readFileSync(saltPath, 'utf8')?.trim();
    if (!saltHex) return null;

    if (
      _keyCache.key &&
      _keyCache.dataDir === dataDir &&
      _keyCache.saltHex === saltHex &&
      _keyCache.blob === `transient:${_transientPassphrase}`
    ) {
      return _keyCache.key;
    }

    const key = pbkdf2Sync(
      _transientPassphrase,
      Buffer.from(saltHex, 'hex'),
      PBKDF2_ITERATIONS,
      32,
      'sha256',
    );
    _keyCache = {
      dataDir,
      saltHex,
      blob: `transient:${_transientPassphrase}`,
      key,
    };
    return key;
  } catch {
    return null;
  }
}

function _encryptBuffer(buffer, key) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(buffer), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([ASSET_MAGIC, iv, tag, encrypted]);
}

function _decryptBuffer(buffer, key) {
  const ivStart = ASSET_MAGIC.length;
  const ivEnd = ivStart + 12;
  const tagEnd = ivEnd + 16;

  const iv = buffer.subarray(ivStart, ivEnd);
  const tag = buffer.subarray(ivEnd, tagEnd);
  const encrypted = buffer.subarray(tagEnd);

  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]);
}

export function isEncryptedAssetBuffer(buffer) {
  return (
    Buffer.isBuffer(buffer) &&
    buffer.length > ASSET_MAGIC.length + 12 + 16 &&
    buffer.subarray(0, ASSET_MAGIC.length).equals(ASSET_MAGIC)
  );
}

export function isLocalAssetPath(targetPath) {
  const dataDir = _getDataDir();
  if (!dataDir || !targetPath) return false;
  return _assetRoots(dataDir).some((root) => _isPathInside(root, targetPath));
}

export function maybeEncryptAssetBufferForPath(
  targetPath,
  buffer,
  options = {},
) {
  const { skip = false } = options;
  if (skip || !isLocalAssetPath(targetPath)) return buffer;
  if (isEncryptedAssetBuffer(buffer)) return buffer;
  const key = _loadAppAssetKey();
  if (!key) return buffer;
  return _encryptBuffer(buffer, key);
}

export function maybeDecryptAssetBufferForPath(targetPath, buffer) {
  if (!isLocalAssetPath(targetPath)) return buffer;
  if (!isEncryptedAssetBuffer(buffer)) return buffer;
  const key = _loadAppAssetKey();
  if (!key) {
    throw new Error('Asset is encrypted but app key is not available');
  }
  return _decryptBuffer(buffer, key);
}

export function setTransientAppPassphrase(passphrase) {
  _transientPassphrase = passphrase || '';
}

export function clearTransientAppPassphrase() {
  _transientPassphrase = '';
  _keyCache = {
    dataDir: '',
    saltHex: '',
    blob: '',
    key: null,
  };
}
