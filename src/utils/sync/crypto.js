import { readLocalAssetData } from './sync-crypto-storage.js';
import { getSyncPath } from './path.js';
import { base64ToBuf } from '@/utils/crypto-codec.js';
import { writeFile as writeSyncFile } from '@/lib/native/fs.js';
import {
  clearSecureBlob,
  loadSecureBlob,
  persistSecureBlobInBackground,
} from '@/utils/safeStorageBlob.js';
import {
  decryptSyncAssetBase64,
  decryptSyncPayload,
  disableSyncEncryptionState,
  encryptSyncAssetBase64,
  encryptSyncPayload,
  getEncryptionState,
  submitEncryptionPassword,
} from '@/lib/native/security.js';
import { ENCRYPTED_ASSET_EXT } from './constants.js';

let _restoreInFlight = null;
const SYNC_BLOB_KEY = 'syncPassphraseBlob';
const state = {
  enabled: false,
  loaded: false,
};

async function refreshState() {
  const syncPath = await getSyncPath();
  const next = await getEncryptionState(syncPath);
  state.enabled = !!next?.syncEnabled;
  state.loaded = !!next?.syncUnlocked;
  return { syncPath, ...next };
}

export function isSyncEncryptionEnabled() {
  return state.enabled;
}

export function isSyncKeyLoaded() {
  return state.loaded;
}

export async function setupSyncEncryption(passphrase) {
  if (!passphrase?.trim()) {
    return { ok: false, error: 'Passphrase cannot be empty.' };
  }

  const syncPath = await getSyncPath();
  if (!syncPath) return { ok: false, error: 'Choose a sync folder first.' };

  try {
    const result = await submitEncryptionPassword(passphrase, 'sync', syncPath);
    if (!result?.ok) {
      return {
        ok: false,
        error: result?.error || 'Unable to enable sync encryption.',
      };
    }
    persistSecureBlobInBackground(SYNC_BLOB_KEY, passphrase, 'syncCrypto');
    state.enabled = !!result?.state?.syncEnabled;
    state.loaded = !!result?.state?.syncUnlocked;
    return { ok: true };
  } catch (err) {
    console.error('[syncCrypto] setup failed:', err);
    return { ok: false, error: String(err) };
  }
}

export async function verifySyncPassphrase(passphrase) {
  if (!passphrase?.trim()) {
    return { ok: false, error: 'Enter your sync passphrase.' };
  }

  const syncPath = await getSyncPath();
  if (!syncPath) return { ok: false, error: 'No sync folder configured.' };

  try {
    const result = await submitEncryptionPassword(
      passphrase,
      'sync',
      syncPath,
      false
    );
    if (!result?.ok) {
      return { ok: false, error: result?.error || 'Wrong passphrase.' };
    }
    persistSecureBlobInBackground(SYNC_BLOB_KEY, passphrase, 'syncCrypto');
    state.enabled = !!result?.state?.syncEnabled;
    state.loaded = !!result?.state?.syncUnlocked;
    return { ok: true };
  } catch (err) {
    console.error('[syncCrypto] verify failed:', err);
    return { ok: false, error: err?.message || String(err) };
  }
}

export async function tryRestoreKeyFromSafeStorage() {
  if (_restoreInFlight) return _restoreInFlight;
  _restoreInFlight = _doRestoreKey().finally(() => {
    _restoreInFlight = null;
  });
  return _restoreInFlight;
}

async function _doRestoreKey() {
  const next = await refreshState();
  if (!next?.syncEnabled || next?.syncUnlocked) {
    return !!next?.syncUnlocked;
  }

  const passphrase = await loadSecureBlob(SYNC_BLOB_KEY);
  if (!passphrase) return false;

  const result = await verifySyncPassphrase(passphrase);
  return result.ok;
}

export async function ensureSyncKeyReadyForWrite() {
  const next = await refreshState();
  const encryptionRequired = !!next?.syncEnabled;
  if (!encryptionRequired) return false;
  if (state.loaded) return true;

  throw new Error(
    'Sync encryption is enabled but the key is locked. Unlock sync encryption first.'
  );
}

export async function disableSyncEncryption(removeCryptoFiles = false) {
  const syncPath = await getSyncPath();
  await disableSyncEncryptionState(syncPath, removeCryptoFiles);
  await clearSecureBlob(SYNC_BLOB_KEY);
  await refreshState();
}

export async function syncFolderHasEncryption() {
  const next = await refreshState();
  return !!next?.syncEnabled;
}

export async function encryptJSON(obj) {
  await ensureSyncKeyReadyForWrite();
  if (!state.loaded) return JSON.stringify(obj);
  return encryptSyncPayload(JSON.stringify(obj));
}

export async function decryptJSON(raw) {
  if (!raw) return null;
  try {
    const plain = await decryptSyncPayload(raw);
    if (plain === null) return null;
    return JSON.parse(plain);
  } catch (err) {
    console.warn('[syncCrypto] decryptJSON error:', err);
    return null;
  }
}

export function syncAssetName(localFilename) {
  return state.enabled
    ? `${localFilename}${ENCRYPTED_ASSET_EXT}`
    : localFilename;
}

export function localAssetName(syncFilename) {
  return syncFilename.endsWith(ENCRYPTED_ASSET_EXT)
    ? syncFilename.slice(0, -ENCRYPTED_ASSET_EXT.length)
    : syncFilename;
}

export async function readAndEncryptAsset(localFilePath) {
  const base64 = await readLocalAssetData(localFilePath);
  if (!state.loaded) return base64;
  return encryptSyncAssetBase64(base64);
}

export async function decryptAndWriteAsset(
  cipherOrBase64,
  destPath,
  options = {}
) {
  const { skipAssetEncryption = false } = options;
  let base64 = cipherOrBase64;

  if (state.loaded) {
    base64 = await decryptSyncAssetBase64(cipherOrBase64);
  }

  if (base64 === null || !base64) {
    throw new Error(
      `[syncCrypto] No decryptable content for asset: ${destPath}`
    );
  }

  await writeSyncFile(destPath, base64ToBuf(base64), { skipAssetEncryption });
}

void refreshState().catch(() => {});
