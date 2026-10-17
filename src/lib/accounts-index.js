import { reactive } from 'vue';
import {
  isEncryptionAvailable,
  encryptString,
  decryptString,
  storeSecureBlob,
  fetchSecureBlob,
  clearSecureBlob,
} from '@/lib/native/security';

// The account list cannot live in the settings store: that pool belongs to a
// workspace and is swapped on switch, so the list would swap with it. This is
// install-level, one entry per signed-in account.
const BLOB_KEY = 'accountsIndex';
// Same dev-instance isolation as account-storage: two app instances share one
// WebKit localStorage, so the mirror key is namespaced per instance.
const MIRROR_KEY =
  BLOB_KEY +
  ((typeof import.meta !== 'undefined' && import.meta.env?.VITE_DUO_SUFFIX) ||
    '');

/**
 * @typedef {Object} IndexedAccount
 * @property {string} id
 * @property {string} [email]
 * @property {string} [label]
 * @property {string} [serverUrl]
 * @property {Object|null} [profile]
 * @property {Object|null} [subscription]
 * @property {Array} [organizations]
 * @property {Object|null} [planLimits]
 * @property {string|null} [activeOrgId]
 * @property {string|null} [activeWorkspaceId]
 * @property {Array} [workspaces]
 * @property {number} [cachedAt]
 */

// Reactive so the switcher's active marker follows a switch without a reload.
// Mutated in place (never reassigned): a component computed tracks this proxy,
// so replacing it would leave every computed reading the previous list.
const cache = reactive(emptyIndex());

function emptyIndex() {
  return { accounts: [], activeAccountId: null };
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

// Exactly one account is active whenever there is at least one account, so a
// removal never leaves the app pointing at nothing.
function normalize(index) {
  const accounts = Array.isArray(index?.accounts)
    ? index.accounts.filter((a) => a && typeof a.id === 'string')
    : [];
  const wanted = index?.activeAccountId;
  const activeAccountId = accounts.some((a) => a.id === wanted)
    ? wanted
    : (accounts[0]?.id ?? null);
  return { accounts, activeAccountId };
}

// Apply in place so the reactive proxy identity (and therefore every component
// computed reading it) survives the write.
function apply(index) {
  const next = normalize(index);
  cache.accounts = next.accounts;
  cache.activeAccountId = next.activeAccountId;
  return cache;
}

async function persist() {
  const json = JSON.stringify(cache);
  // Always save the encrypted mirror: it survives a backend that is unavailable.
  try {
    localStorage.setItem(MIRROR_KEY, await encryptString(toBase64(json)));
  } catch {
    // Encryption failed: never persist a plaintext backup.
  }
  if (await safeStorageAvailable()) {
    try {
      await storeSecureBlob(BLOB_KEY, await encryptString(toBase64(json)));
    } catch {
      // Secure storage failed; the encrypted mirror is already saved.
    }
  }
}

export async function loadIndex() {
  try {
    if (await safeStorageAvailable()) {
      try {
        const cipher = await fetchSecureBlob(BLOB_KEY);
        if (cipher) {
          return apply(JSON.parse(fromBase64(await decryptString(cipher))));
        }
      } catch {
        // Fall through to the mirror.
      }
    }
    const mirror = localStorage.getItem(MIRROR_KEY);
    if (mirror) {
      try {
        return apply(JSON.parse(fromBase64(await decryptString(mirror))));
      } catch {
        // Decryption failed, no plaintext fallback exists.
      }
    }
  } catch (err) {
    console.error('[accountsIndex] loadIndex failed:', err);
  }
  return apply(emptyIndex());
}

export async function saveIndex(index) {
  apply(index);
  await persist();
  return cache;
}

export function listAccounts() {
  return cache.accounts;
}

export function getAccount(id) {
  return cache.accounts.find((a) => a.id === id) ?? null;
}

export function getActiveAccountId() {
  return cache.activeAccountId;
}

// Synchronous by contract: callers read it while rendering. The write is
// fire-and-forget so a render never waits on the backend.
export function setActiveAccountId(id) {
  if (cache.activeAccountId === id) return;
  apply({ ...cache, activeAccountId: id });
  void persist();
}

export async function upsertAccount(record) {
  if (!record?.id) return cache;
  const accounts = cache.accounts.slice();
  const at = accounts.findIndex((a) => a.id === record.id);
  if (at === -1) {
    accounts.push(record);
  } else {
    accounts[at] = { ...accounts[at], ...record };
  }
  apply({ ...cache, accounts });
  await persist();
  return cache;
}

export async function removeAccountRecord(id) {
  apply({
    accounts: cache.accounts.filter((a) => a.id !== id),
    activeAccountId:
      cache.activeAccountId === id ? null : cache.activeAccountId,
  });
  await persist();
  return cache;
}

export async function clearIndex() {
  apply(emptyIndex());
  try {
    await clearSecureBlob(BLOB_KEY);
  } catch (err) {
    console.error('[accountsIndex] clearIndex blob failed:', err);
  }
  localStorage.removeItem(MIRROR_KEY);
}
