import { backend } from '@/lib/tauri-bridge';

export async function storeSecureBlob(
  key,
  plainText,
  logPrefix = 'secureBlob'
) {
  try {
    const available = await backend.invoke(
      'safeStorage:isEncryptionAvailable'
    );
    if (!available) return;

    const blob = await backend.invoke(
      'safeStorage:encryptString',
      plainText
    );
    await backend.invoke('safeStorage:storeBlob', { key, blob });
  } catch (err) {
    console.warn(`[${logPrefix}] passphrase store failed:`, err);
  }
}

export async function loadSecureBlob(key) {
  try {
    const blob = await backend.invoke('safeStorage:fetchBlob', key);
    if (!blob) return null;
    return await backend.invoke('safeStorage:decryptString', blob);
  } catch {
    return null;
  }
}

export async function clearSecureBlob(key) {
  try {
    await backend.invoke('safeStorage:clearBlob', key);
  } catch {
    // ignore
  }
}
