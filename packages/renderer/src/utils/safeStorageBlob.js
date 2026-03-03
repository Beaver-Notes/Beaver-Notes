const { ipcRenderer } = window.electron;

export async function storeSecureBlob(
  key,
  plainText,
  logPrefix = 'secureBlob'
) {
  try {
    const available = await ipcRenderer.callMain(
      'safeStorage:isEncryptionAvailable'
    );
    if (!available) return;

    const blob = await ipcRenderer.callMain(
      'safeStorage:encryptString',
      plainText
    );
    await ipcRenderer.callMain('safeStorage:storeBlob', { key, blob });
  } catch (err) {
    console.warn(`[${logPrefix}] passphrase store failed:`, err);
  }
}

export async function loadSecureBlob(key) {
  try {
    const blob = await ipcRenderer.callMain('safeStorage:fetchBlob', key);
    if (!blob) return null;
    return await ipcRenderer.callMain('safeStorage:decryptString', blob);
  } catch {
    return null;
  }
}

export async function clearSecureBlob(key) {
  try {
    await ipcRenderer.callMain('safeStorage:clearBlob', key);
  } catch {
    // ignore
  }
}
