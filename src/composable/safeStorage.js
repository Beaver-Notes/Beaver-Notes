import {
  decryptString as decryptSecureString,
  encryptString as encryptSecureString,
  isEncryptionAvailable as isSecureStorageAvailable,
} from '@/lib/native/security';

export async function isEncryptionAvailable() {
  return isSecureStorageAvailable();
}

export async function encryptString(plainText) {
  return encryptSecureString(plainText);
}

export async function decryptString(encryptedBase64) {
  return decryptSecureString(encryptedBase64);
}
