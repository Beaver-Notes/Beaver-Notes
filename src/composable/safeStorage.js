import { backend } from '@/lib/tauri-bridge';

export async function isEncryptionAvailable() {
  return backend.invoke('safeStorage:isEncryptionAvailable');
}

export async function encryptString(plainText) {
  return backend.invoke('safeStorage:encryptString', plainText);
}

export async function decryptString(encryptedBase64) {
  return backend.invoke('safeStorage:decryptString', encryptedBase64);
}
