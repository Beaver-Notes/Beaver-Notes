import { createMlKem768 } from 'mlkem';
import { loadSecureBlob, persistSecureBlobInBackground } from './safeStorageBlob.js';
import { setKeypair } from '@/lib/api/auth';
import { getActiveAccountId } from '@/lib/accounts-index';

const LEGACY_BLOB_KEY = 'e2eIdentityKeypair';

// One identity per account: a shared keypair would let the server tie two
// accounts to one device, so each account gets its own blob. Until an account
// is active (first launch, before the index exists) the legacy install-level
// slot still applies, which keeps an un-migrated install working.
export function identityBlobKey(accountId = getActiveAccountId()) {
  return accountId ? `${LEGACY_BLOB_KEY}:${accountId}` : LEGACY_BLOB_KEY;
}

function bytesToHex(buf) {
  return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function generateIdentity() {
  const instance = await createMlKem768();
  const [pk, sk] = instance.generateKeyPair();
  return {
    publicKeyHex: bytesToHex(pk),
    privateKeyHex: bytesToHex(sk),
  };
}

export async function loadOrCreateIdentity(accountId = getActiveAccountId()) {
  const blobKey = identityBlobKey(accountId);
  let stored = null;
  try {
    stored = await loadSecureBlob(blobKey);
  } catch (err) {
    // Backend unreadable (missing dir, keyring error). Falling through mints a
    // fresh identity; throwing instead left every caller's catch silently
    // bailing, so the device never published its public key and no collaborator
    // could wrap a key for it.
    // ponytail: a backend that stays unreadable mints a new identity per launch
    // (churn replaces the device's published key). Acceptable while unreadable
    // == unusable; revisit if a persistent backend failure path appears.
    console.warn('[identity] secure blob unreadable; minting fresh identity', err);
  }
  if (stored) {
    try {
      const parsed = JSON.parse(stored);
      if (parsed?.publicKeyHex && parsed?.privateKeyHex) return parsed;
    } catch {
      // fall through to regenerate
    }
  }
  const identity = await generateIdentity();
  await persistSecureBlobInBackground(blobKey, JSON.stringify(identity), 'e2eIdentity');
  return identity;
}

// ponytail: baseUrl is threaded in rather than read from the account store here,
// because this module is imported by the auth composable that owns the store and
// importing it back would be circular. Omitting it silently posts the public key
// to DEFAULT_API_URL (production), which is how devices ended up missing from
// accounts.deviceKeys and every shared note opened empty.
export async function publishIdentity(
  identity = null,
  deviceId = null,
  baseUrl,
  accountId = getActiveAccountId(),
) {
  const id = identity ?? (await loadOrCreateIdentity(accountId));
  return setKeypair(id.publicKeyHex, { deviceId, baseUrl });
}
