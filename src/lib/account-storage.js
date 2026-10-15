import {
  isEncryptionAvailable,
  encryptString,
  decryptString,
  storeSecureBlob,
  fetchSecureBlob,
  clearSecureBlob,
} from '@/lib/native/security';

const SESSION_BLOB_KEY = 'beaverAccountSession';
// Duo/dev isolation: two app instances on one machine share the WebKit
// localStorage, so a fresh instance would resurrect the other instance's
// session through the mirror fallback. VITE_DUO_SUFFIX namespaces the
// mirror key per instance (secure blobs are already per-instance via
// BEAVER_NOTES_DATA_DIR). Empty in prod: key unchanged.
const SESSION_MIRROR_KEY =
  SESSION_BLOB_KEY +
  ((typeof import.meta !== 'undefined' && import.meta.env?.VITE_DUO_SUFFIX) ||
    '');
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
    localStorage.setItem(SESSION_MIRROR_KEY, cipher);
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
    const cipher = localStorage.getItem(SESSION_MIRROR_KEY);
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
    localStorage.removeItem(SESSION_MIRROR_KEY);
    localStorage.removeItem(SESSION_BLOB_KEY + '_plain');
  } catch (err) {
    console.error('[accountStorage] clearSessionToken failed:', err);
  }
}

// Refresh token storage. Same encryption and secure-storage rules as the
// session token, but a separate slot: clearing the session must NOT throw the
// refresh token away, or the next 401 could never be recovered from.
const REFRESH_BLOB_KEY = 'accountRefreshTokenBlob';
const REFRESH_MIRROR_KEY = 'accountRefreshTokenMirror';

export async function saveRefreshToken(token) {
  if (!token) {
    await clearRefreshToken();
    return;
  }
  try {
    const cipher = await encryptString(toBase64(token));
    localStorage.setItem(REFRESH_MIRROR_KEY, cipher);
  } catch {
    // Encryption failed: never persist a plaintext backup.
  }
  if (await safeStorageAvailable()) {
    try {
      const cipher = await encryptString(toBase64(token));
      await storeSecureBlob(REFRESH_BLOB_KEY, cipher);
    } catch {
      // secure storage failed, encrypted localStorage mirror is already saved
    }
  }
}

export async function loadRefreshToken() {
  try {
    if (await safeStorageAvailable()) {
      try {
        const cipher = await fetchSecureBlob(REFRESH_BLOB_KEY);
        if (cipher) {
          const plain = await decryptString(cipher);
          return fromBase64(plain) || null;
        }
      } catch {
        // Fall through to localStorage
      }
    }
    const cipher = localStorage.getItem(REFRESH_MIRROR_KEY);
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
    console.error('[accountStorage] loadRefreshToken failed:', err);
    return null;
  }
}

export async function clearRefreshToken() {
  // The mirror removal must not depend on the secure store: if clearing the
  // blob throws, a dead refresh token would survive and be retried forever.
  try {
    await clearSecureBlob(REFRESH_BLOB_KEY);
  } catch (err) {
    console.error('[accountStorage] clearRefreshToken blob failed:', err);
  }
  localStorage.removeItem(REFRESH_MIRROR_KEY);
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
    // The refresh token is a credential in its own right: signing out must not
    // leave one on the disk that can mint a fresh session.
    clearRefreshToken(),
    clearCachedProfile(),
    clearAccountDeviceId(),
  ]);
}

export function useAccountStorage() {
  return {
    saveSessionToken,
    loadSessionToken,
    clearSessionToken,
    saveRefreshToken,
    loadRefreshToken,
    clearRefreshToken,
    saveCachedProfile,
    loadCachedProfile,
    clearCachedProfile,
    saveAccountDeviceId,
    loadAccountDeviceId,
    clearAccountDeviceId,
    clearAllAccountStorage,
  };
}
