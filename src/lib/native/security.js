import { backend } from '@/lib/tauri-bridge';
import { path } from '@/lib/tauri-bridge';
import { readData, readDir, writeFile } from '@/lib/native/fs';
import { base64ToUint8Array } from '@/utils/helpers/index.js';

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

export function migrateAssetEncryption() {
  return backend.invoke('assetCrypto:migrateDir');
}

export function getEncryptionState() {
  return backend.invoke('encryption:getState');
}

export function submitEncryptionPassword(
  password,
  createIfMissing = true
) {
  return backend.invoke('encryption:submitPassword', {
    password,
    createIfMissing,
  });
}

export function enableEncryption(password) {
  return backend.invoke('encryption:enable', password);
}

export function unlockEncryption(password) {
  return backend.invoke('encryption:unlock', { password });
}

export function lockEncryption() {
  return backend.invoke('encryption:lock');
}

export function encryptNotePayload(plainBytes) {
  return backend.invoke('encryption:encryptNotePayload', plainBytes);
}

export function rotateEncryptionKey() {
  return backend.invoke('encryption:rotateKey');
}

export function generateRecoveryCode() {
  return backend.invoke('encryption:generateRecoveryCode');
}

export function recoverWithCode(code) {
  return backend.invoke('encryption:recoverWithCode', { code });
}

export function decryptNotePayload(payload) {
  return backend.invoke('encryption:decryptNotePayload', payload);
}

export function syncEncryptPayload(meta, data, aad) {
  return backend.invoke('sync:encryptPayload', { meta, data, aad });
}

export function syncDecryptPayload(enc, aad) {
  return backend.invoke('sync:decryptPayload', { enc, aad });
}

export function syncEncryptBatch(metas, dataB64s, aads) {
  return backend.invoke('sync:encryptBatch', { metas, dataB64s, aads });
}

export function syncDecryptBatch(envelopes, aads) {
  return backend.invoke('sync:decryptBatch', { envelopes, aads });
}

export function syncKeyReady() {
  return backend.invoke('sync:keyReady');
}

export function reconcileSyncKeyParams(passphrase) {
  return backend.invoke('encryption:reconcileKeyParams', { passphrase });
}

export function adoptKeyParams(passphrase, keyParams) {
  return backend.invoke(
    'encryption:adoptKeyParams',
    keyParams == null ? { passphrase } : { passphrase, keyParams },
  );
}

export function hasRemoteKeyParams() {
  return backend.invoke('encryption:hasRemoteKeyParams');
}

export function decryptAssetStream(path) {
  return backend.invoke('assetCrypto:decryptAssetStream', path);
}

export function encryptAssetStream(path) {
  return backend.invoke('assetCrypto:encryptAssetStream', path);
}

export function cacheDecryptedNote(noteId, content) {
  return backend.invoke('crypto:cacheDecryptedNote', { noteId, content });
}

export function getCachedDecryptedNote(noteId) {
  return backend.invoke('crypto:getCachedDecryptedNote', noteId);
}

export function clearDecryptedCaches() {
  return backend.invoke('crypto:clearDecryptedCaches');
}

export function decryptLegacyCryptoJSNote(ciphertextB64, password) {
  return backend.invoke('crypto:decryptLegacyNote', { ciphertextB64, password });
}

export function deriveArgon2Key(passphrase, salt) {
  return backend.invoke('crypto:deriveArgon2Key', { passphrase, salt });
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



function isIgnoredAssetEntry(name) {
  return !name || name.startsWith('.') || name === 'Thumbs.db';
}

export async function listAssetFiles(appDirectory) {
  const files = [];
  const rootDir = path.join(appDirectory, 'assets');
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

  return files;
}

export async function rewriteAssetFile(filePath) {
  const base64 = await readData(filePath);
  if (!base64) return false;

  await writeFile(filePath, base64ToUint8Array(base64));
  return true;
}

export function onAssetMigrationProgress(handler) {
  return backend.listen('asset-migration-progress', handler);
}
