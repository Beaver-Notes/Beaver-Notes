import {
  clearSecureBlob as clearStoredBlob,
  decryptString,
  encryptString,
  fetchSecureBlob,
  isEncryptionAvailable,
  storeSecureBlob as storeStoredBlob,
} from '@/lib/native/security';

export async function storeSecureBlob(
  key,
  plainText,
  logPrefix = 'secureBlob'
) {
  try {
    const available = await isEncryptionAvailable();
    if (!available) return;

    const blob = await encryptString(plainText);
    await storeStoredBlob(key, blob);
  } catch (err) {
    console.warn(`[${logPrefix}] passphrase store failed:`, err);
  }
}

export async function loadSecureBlob(key) {
  try {
    const blob = await fetchSecureBlob(key);
    if (!blob) return null;
    return await decryptString(blob);
  } catch {
    return null;
  }
}

export async function clearSecureBlob(key) {
  try {
    await clearStoredBlob(key);
  } catch {
    // ignore
  }
}
