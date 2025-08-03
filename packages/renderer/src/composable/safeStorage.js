const { ipcRenderer } = window.electron;

export async function isEncryptionAvailable() {
  return ipcRenderer.callMain('safeStorage:isEncryptionAvailable');
}

export async function encryptString(plainText) {
  return ipcRenderer.callMain('safeStorage:encryptString', plainText);
}

export async function decryptString(encryptedBase64) {
  return ipcRenderer.callMain('safeStorage:decryptString', encryptedBase64);
}

export async function getSelectedStorageBackend() {
  return ipcRenderer.callMain('safeStorage:getSelectedStorageBackend');
}
