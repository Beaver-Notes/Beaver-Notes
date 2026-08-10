import { createMlKem768 } from 'mlkem';
import { loadSecureBlob, persistSecureBlobInBackground } from './safeStorageBlob.js';
import { setKeypair } from '@/lib/api/auth';

const BLOB_KEY = 'e2eIdentityKeypair';

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

export async function loadOrCreateIdentity() {
  const stored = await loadSecureBlob(BLOB_KEY);
  if (stored) {
    try {
      const parsed = JSON.parse(stored);
      if (parsed?.publicKeyHex && parsed?.privateKeyHex) return parsed;
    } catch {
      // fall through to regenerate
    }
  }
  const identity = await generateIdentity();
  await persistSecureBlobInBackground(BLOB_KEY, JSON.stringify(identity), 'e2eIdentity');
  return identity;
}

export async function publishIdentity(identity = null) {
  const id = identity ?? (await loadOrCreateIdentity());
  return setKeypair(id.publicKeyHex, {});
}
