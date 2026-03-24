import { backend } from '@/lib/tauri-bridge';
import { path } from '@/lib/tauri-bridge';
import { readData, readDir, writeFile } from '@/lib/native/fs';

export function isEncryptionAvailable() {
  return backend.invoke('safeStorage:isEncryptionAvailable');
}

export function encryptString(plainText) {
  return backend.invoke('safeStorage:encryptString', plainText);
}

export function decryptString(encryptedBase64) {
  return backend.invoke('safeStorage:decryptString', encryptedBase64);
}

export function storeSecureBlob(key, blob) {
  return backend.invoke('safeStorage:storeBlob', { key, blob });
}

export function fetchSecureBlob(key) {
  return backend.invoke('safeStorage:fetchBlob', key);
}

export function clearSecureBlob(key) {
  return backend.invoke('safeStorage:clearBlob', key);
}

export function setAssetPassphrase(passphrase) {
  return backend.invoke('assetCrypto:setAppPassphrase', passphrase);
}

export function clearAssetPassphrase() {
  return backend.invoke('assetCrypto:clearAppPassphrase');
}

export function hashPassword(password) {
  return backend.invoke('passwd:hash', password);
}

export function comparePassword(password, hash) {
  return backend.invoke('passwd:compare', { password, hash });
}

export function recordPasswordFailure() {
  return backend.invoke('passwd:recordFailure');
}

export function resetPasswordFailures() {
  return backend.invoke('passwd:resetFailures');
}

function base64ToUint8Array(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function isIgnoredAssetEntry(name) {
  return !name || name.startsWith('.') || name === 'Thumbs.db';
}

export async function listAssetFiles(dataDir) {
  const roots = ['notes-assets', 'file-assets'];
  const files = [];

  for (const root of roots) {
    const rootDir = path.join(dataDir, root);
    const noteDirs = await readDir(rootDir).catch(() => []);

    for (const noteDir of noteDirs) {
      if (isIgnoredAssetEntry(noteDir)) continue;
      const fullNoteDir = path.join(rootDir, noteDir);
      const assetNames = await readDir(fullNoteDir).catch(() => []);

      for (const assetName of assetNames) {
        if (isIgnoredAssetEntry(assetName)) continue;
        files.push(path.join(fullNoteDir, assetName));
      }
    }
  }

  return files;
}

export async function rewriteAssetFile(
  filePath,
  { skipAssetEncryption = false } = {}
) {
  const base64 = await readData(filePath);
  if (!base64) return false;

  await writeFile(filePath, base64ToUint8Array(base64), {
    skipAssetEncryption,
  });
  return true;
}
