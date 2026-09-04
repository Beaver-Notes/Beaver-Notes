import {
  isEncryptionAvailable,
  encryptString,
  decryptString,
  storeSecureBlob,
  fetchSecureBlob,
  clearSecureBlob,
} from '@/lib/native/security';

const SESSION_BLOB_KEY = 'beaverAccountSession';
const DEVICE_BLOB_KEY = 'beaverAccountDeviceId';
const PROFILE_BLOB_KEY = 'beaverAccountProfile';

function safeStorageAvailable() {
  return isEncryptionAvailable().catch(() => false);
}

function toBase64(input) {
  if (input == null) return '';
  if (typeof input !== 'string') {
    input = JSON.stringify(input);
  }
  if (typeof btoa === 'function') {
    try {
      return btoa(unescape(encodeURIComponent(input)));
    } catch {
      return input;
    }
  }
  return input;
}

function fromBase64(base64) {
  if (!base64) return '';
  if (typeof atob !== 'function') return base64;
  try {
    return decodeURIComponent(escape(atob(base64)));
  } catch {
    return base64;
  }
}

export async function saveSessionToken(token) {
  if (!token) {
    await clearSessionToken();
    return;
  }
  // Always save to localStorage as backup
  try {
    const cipher = await encryptString(toBase64(token));
    localStorage.setItem(SESSION_BLOB_KEY, cipher);
  } catch {
    // Encryption failed: never persist plaintext backup.
  }
  // Also save to secure storage if available
  if (await safeStorageAvailable()) {
    try {
      const cipher = await encryptString(toBase64(token));
      await storeSecureBlob(SESSION_BLOB_KEY, cipher);
    } catch {
      // secure storage failed, encrypted localStorage mirror is already saved
    }
  }
}

export async function loadSessionToken() {
  try {
    // Opportunistically scrub a legacy plaintext backup written before the
    // no-plaintext-fallback rule.
    if (localStorage.getItem(SESSION_BLOB_KEY + '_plain')) {
      localStorage.removeItem(SESSION_BLOB_KEY + '_plain');
    }
    // Try secure storage first
    if (await safeStorageAvailable()) {
      try {
        const cipher = await fetchSecureBlob(SESSION_BLOB_KEY);
        if (cipher) {
          const plain = await decryptString(cipher);
          return fromBase64(plain) || null;
        }
      } catch {
        // Fall through to localStorage
      }
    }
    // Try localStorage with decryption
    const cipher = localStorage.getItem(SESSION_BLOB_KEY);
    if (cipher) {
      try {
        const plain = await decryptString(cipher);
        return fromBase64(plain) || null;
      } catch {
        // Decryption failed, no plaintext fallback exists
      }
    }
    return null;
  } catch (err) {
    console.error('[accountStorage] loadSessionToken failed:', err);
    return null;
  }
}

export async function clearSessionToken() {
  try {
    await clearSecureBlob(SESSION_BLOB_KEY);
    localStorage.removeItem(SESSION_BLOB_KEY);
    localStorage.removeItem(SESSION_BLOB_KEY + '_plain');
  } catch (err) {
    console.error('[accountStorage] clearSessionToken failed:', err);
  }
}

export async function saveCachedProfile(profile) {
  if (!profile) {
    await clearCachedProfile();
    return;
  }
  try {
    if (!(await safeStorageAvailable())) return;
    const cipher = await encryptString(toBase64(profile));
    await storeSecureBlob(PROFILE_BLOB_KEY, cipher);
  } catch (err) {
    console.error('[accountStorage] saveCachedProfile failed:', err);
  }
}

export async function loadCachedProfile() {
  try {
    if (!(await safeStorageAvailable())) return null;
    const cipher = await fetchSecureBlob(PROFILE_BLOB_KEY);
    if (!cipher) return null;
    const plain = await decryptString(cipher);
    return JSON.parse(fromBase64(plain) || 'null');
  } catch (err) {
    console.error('[accountStorage] loadCachedProfile failed:', err);
    return null;
  }
}

export async function clearCachedProfile() {
  try {
    await clearSecureBlob(PROFILE_BLOB_KEY);
  } catch (err) {
    console.error('[accountStorage] clearCachedProfile failed:', err);
  }
}

export async function saveAccountDeviceId(deviceId) {
  if (!deviceId) {
    await clearAccountDeviceId();
    return;
  }
  try {
    if (!(await safeStorageAvailable())) return;
    const cipher = await encryptString(toBase64(deviceId));
    await storeSecureBlob(DEVICE_BLOB_KEY, cipher);
  } catch (err) {
    console.error('[accountStorage] saveAccountDeviceId failed:', err);
  }
}

export async function loadAccountDeviceId() {
  try {
    if (!(await safeStorageAvailable())) return null;
    const cipher = await fetchSecureBlob(DEVICE_BLOB_KEY);
    if (!cipher) return null;
    const plain = await decryptString(cipher);
    return fromBase64(plain) || null;
  } catch (err) {
    console.error('[accountStorage] loadAccountDeviceId failed:', err);
    return null;
  }
}

export async function clearAccountDeviceId() {
  try {
    await clearSecureBlob(DEVICE_BLOB_KEY);
  } catch (err) {
    console.error('[accountStorage] clearAccountDeviceId failed:', err);
  }
}

export async function clearAllAccountStorage() {
  await Promise.all([
    clearSessionToken(),
    clearCachedProfile(),
    clearAccountDeviceId(),
  ]);
}

export function useAccountStorage() {
  return {
    saveSessionToken,
    loadSessionToken,
    clearSessionToken,
    saveCachedProfile,
    loadCachedProfile,
    clearCachedProfile,
    saveAccountDeviceId,
    loadAccountDeviceId,
    clearAccountDeviceId,
    clearAllAccountStorage,
  };
}
