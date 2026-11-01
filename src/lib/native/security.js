import { backend } from '@/lib/tauri-bridge';

export function isEncryptionAvailable() {
  return backend.invoke('safeStorage:isEncryptionAvailable');
}

export function getSafeStorageBackendInfo() {
  return backend.invoke('safeStorage:getBackendInfo');
}

export function setDevicePassword(password) {
  return backend.invoke('safeStorage:setDevicePassword', password);
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

export function encryptNotePayload(plainBytes) {
  return backend.invoke('encryption:encryptNotePayload', plainBytes);
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

export function localKeyParamsJson() {
  return backend.invoke('encryption:localKeyParamsJson');
}

export function remoteParamsDiffer(paramsJson) {
  return backend.invoke('encryption:remoteParamsDiffer', { paramsJson });
}

export function decryptLegacyCryptoJSNote(ciphertextB64, password) {
  return backend.invoke('crypto:decryptLegacyNote', { ciphertextB64, password });
}

export function deriveArgon2Key(passphrase, salt) {
  return backend.invoke('crypto:deriveArgon2Key', { passphrase, salt });
}
