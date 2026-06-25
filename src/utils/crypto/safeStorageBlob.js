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
  const available = await isEncryptionAvailable();
  if (!available) {
    console.warn(
      `[${logPrefix}] safe storage not available — passphrase will not be persisted`
    );
    return;
  }

  const blob = await encryptString(plainText);
  await storeStoredBlob(key, blob);
}

export function persistSecureBlobInBackground(
  key,
  plainText,
  logPrefix = 'secureBlob'
) {
  return storeSecureBlob(key, plainText, logPrefix).catch((err) => {
    console.error(
      `[${logPrefix}] CRITICAL: passphrase persistence failed — auto-unlock will not work on next launch`,
      err
    );
  });
}

export async function loadSecureBlob(key) {
  try {
    const blob = await fetchSecureBlob(key);
    if (!blob) return null;
    return await decryptString(blob);
  } catch (err) {
    const msg = err?.message || String(err);
    if (
      msg.includes('not found') ||
      msg.includes('No entry') ||
      msg.includes('not exist')
    ) {
      return null;
    }
    console.error(
      '[secureBlob] Failed to load secure blob — keyring may be corrupted',
      err
    );
    throw err;
  }
}

export async function clearSecureBlob(key) {
  try {
    await clearStoredBlob(key);
  } catch (err) {
    console.error('[secureBlob] Failed to clear secure blob', err);
    throw err;
  }
}
