import {
  isEncryptionAvailable,
  encryptString,
  decryptString,
  storeSecureBlob,
  fetchSecureBlob,
  clearSecureBlob,
} from '@/lib/native/security';
import { getActiveAccountId } from '@/lib/accounts-index';

const SESSION_BLOB_KEY = 'beaverAccountSession';
const REFRESH_BLOB_KEY = 'accountRefreshTokenBlob';
const PROFILE_BLOB_KEY = 'beaverAccountProfile';
const DEVICE_BLOB_KEY = 'beaverAccountDeviceId';

// Duo/dev isolation: two app instances on one machine share the WebKit
// localStorage, so a fresh instance would resurrect the other instance's
// session through the mirror fallback. VITE_DUO_SUFFIX namespaces the
// mirror key per instance (secure blobs are already per-instance via
// BEAVER_NOTES_DATA_DIR). Empty in prod: key unchanged.
const DUO_SUFFIX =
  (typeof import.meta !== 'undefined' && import.meta.env?.VITE_DUO_SUFFIX) ||
  '';

// Credentials are per account, so each key is `<base>:<accountId>`. With no
// account id (signed out, or an install that predates accounts) the
// pre-migration install-level key is used unchanged — which is also what keeps
// a downgrade working.
export function sessionBlobKey(accountId) {
  return accountId ? `accountSession:${accountId}` : SESSION_BLOB_KEY;
}

export function sessionMirrorKey(accountId) {
  return sessionBlobKey(accountId) + DUO_SUFFIX;
}

export function refreshBlobKey(accountId) {
  return accountId ? `accountRefreshToken:${accountId}` : REFRESH_BLOB_KEY;
}

export function refreshMirrorKey(accountId) {
  // The pre-migration mirror carries no duo suffix; keep that exact key so an
  // upgrade cannot orphan the refresh token already on disk.
  return accountId
    ? `accountRefreshToken:${accountId}${DUO_SUFFIX}`
    : 'accountRefreshTokenMirror';
}

export function profileBlobKey(accountId) {
  return accountId ? `accountProfile:${accountId}` : PROFILE_BLOB_KEY;
}

function resolveAccountId(accountId) {
  return accountId ?? getActiveAccountId();
}

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

export async function saveSessionToken(token, accountId) {
  const id = resolveAccountId(accountId);
  if (!token) {
    await clearSessionToken(id);
    return;
  }
  // Always save to localStorage as backup
  try {
    const cipher = await encryptString(toBase64(token));
    localStorage.setItem(sessionMirrorKey(id), cipher);
  } catch {
    // Encryption failed: never persist plaintext backup.
  }
  // Also save to secure storage if available
  if (await safeStorageAvailable()) {
    try {
      const cipher = await encryptString(toBase64(token));
      await storeSecureBlob(sessionBlobKey(id), cipher);
    } catch {
      // secure storage failed, encrypted localStorage mirror is already saved
    }
  }
}

export async function loadSessionToken(accountId) {
  const id = resolveAccountId(accountId);
  try {
    // Opportunistically scrub a legacy plaintext backup written before the
    // no-plaintext-fallback rule.
    if (localStorage.getItem(SESSION_BLOB_KEY + '_plain')) {
      localStorage.removeItem(SESSION_BLOB_KEY + '_plain');
    }
    // Try secure storage first
    if (await safeStorageAvailable()) {
      try {
        const cipher = await fetchSecureBlob(sessionBlobKey(id));
        if (cipher) {
          const plain = await decryptString(cipher);
          return fromBase64(plain) || null;
        }
      } catch {
        // Fall through to localStorage
      }
    }
    // Try localStorage with decryption
    const cipher = localStorage.getItem(sessionMirrorKey(id));
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

export async function clearSessionToken(accountId) {
  const id = resolveAccountId(accountId);
  try {
    await clearSecureBlob(sessionBlobKey(id));
    localStorage.removeItem(sessionMirrorKey(id));
    localStorage.removeItem(SESSION_BLOB_KEY + '_plain');
  } catch (err) {
    console.error('[accountStorage] clearSessionToken failed:', err);
  }
}

// Refresh token storage. Same encryption and secure-storage rules as the
// session token, but a separate slot: clearing the session must NOT throw the
// refresh token away, or the next 401 could never be recovered from.
export async function saveRefreshToken(token, accountId) {
  const id = resolveAccountId(accountId);
  if (!token) {
    await clearRefreshToken(id);
    return;
  }
  try {
    const cipher = await encryptString(toBase64(token));
    localStorage.setItem(refreshMirrorKey(id), cipher);
  } catch {
    // Encryption failed: never persist a plaintext backup.
  }
  if (await safeStorageAvailable()) {
    try {
      const cipher = await encryptString(toBase64(token));
      await storeSecureBlob(refreshBlobKey(id), cipher);
    } catch {
      // secure storage failed, encrypted localStorage mirror is already saved
    }
  }
}

export async function loadRefreshToken(accountId) {
  const id = resolveAccountId(accountId);
  try {
    if (await safeStorageAvailable()) {
      try {
        const cipher = await fetchSecureBlob(refreshBlobKey(id));
        if (cipher) {
          const plain = await decryptString(cipher);
          return fromBase64(plain) || null;
        }
      } catch {
        // Fall through to localStorage
      }
    }
    const cipher = localStorage.getItem(refreshMirrorKey(id));
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

export async function clearRefreshToken(accountId) {
  const id = resolveAccountId(accountId);
  // The mirror removal must not depend on the secure store: if clearing the
  // blob throws, a dead refresh token would survive and be retried forever.
  try {
    await clearSecureBlob(refreshBlobKey(id));
  } catch (err) {
    console.error('[accountStorage] clearRefreshToken blob failed:', err);
  }
  localStorage.removeItem(refreshMirrorKey(id));
}

export async function saveCachedProfile(profile, accountId) {
  const id = resolveAccountId(accountId);
  if (!profile) {
    await clearCachedProfile(id);
    return;
  }
  try {
    if (!(await safeStorageAvailable())) return;
    const cipher = await encryptString(toBase64(profile));
    await storeSecureBlob(profileBlobKey(id), cipher);
  } catch (err) {
    console.error('[accountStorage] saveCachedProfile failed:', err);
  }
}

export async function loadCachedProfile(accountId) {
  const id = resolveAccountId(accountId);
  try {
    if (!(await safeStorageAvailable())) return null;
    const cipher = await fetchSecureBlob(profileBlobKey(id));
    if (!cipher) return null;
    const plain = await decryptString(cipher);
    return JSON.parse(fromBase64(plain) || 'null');
  } catch (err) {
    console.error('[accountStorage] loadCachedProfile failed:', err);
    return null;
  }
}

export async function clearCachedProfile(accountId) {
  const id = resolveAccountId(accountId);
  try {
    await clearSecureBlob(profileBlobKey(id));
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

// No argument means the install-level sign-out: it wipes the active account's
// credentials and the device registration. An explicit account id clears only
// that account, so signing one account out cannot unregister the others.
export async function clearAllAccountStorage(accountId) {
  const target = resolveAccountId(accountId);
  await Promise.all([
    clearSessionToken(target),
    // The refresh token is a credential in its own right: signing out must not
    // leave one on the disk that can mint a fresh session.
    clearRefreshToken(target),
    clearCachedProfile(target),
  ]);
  if (accountId == null) {
    await clearAccountDeviceId();
  }
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
