import { createMlKem768 } from 'mlkem';
import { importCollabKey, isValidCollabKey } from './collab.js';

// Cache for unwrapped note key hex values (noteId -> noteKeyHex)
// Avoids repeated ML-KEM768 decap + AES-GCM unwrap on every access.
const unwrappedKeyCache = new Map();

export function clearUnwrappedKeyCache(noteId) {
  if (noteId) {
    unwrappedKeyCache.delete(noteId);
  } else {
    unwrappedKeyCache.clear();
  }
}

async function bytesToHex(buf) { return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join(''); }
function hexToBytes(hex) { const b = new Uint8Array(hex.length / 2); for (let i = 0; i < hex.length; i += 2) b[i / 2] = parseInt(hex.substring(i, i + 2), 16); return b; }

export async function wrapNoteKeyForRecipient(publicKeyHex, noteKeyHex) {
  const instance = await createMlKem768();
  const [kemCt, sharedSecret] = await instance.encap(hexToBytes(publicKeyHex));
  const key = await importCollabKey(await bytesToHex(sharedSecret));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, tagLength: 128 }, key, new TextEncoder().encode(noteKeyHex));
  return JSON.stringify({
    kemCt: await bytesToHex(kemCt),
    iv: await bytesToHex(iv),
    ct: await bytesToHex(new Uint8Array(ciphertext)),
  });
}

export async function unwrapNoteKey(privateKeyHex, envelopeStr) {
  const env = typeof envelopeStr === 'string' ? JSON.parse(envelopeStr) : envelopeStr;
  const instance = await createMlKem768();
  const sharedSecret = await instance.decap(hexToBytes(env.kemCt), hexToBytes(privateKeyHex));
  const key = await importCollabKey(await bytesToHex(sharedSecret));
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: hexToBytes(env.iv), tagLength: 128 },
    key,
    hexToBytes(env.ct)
  );
  return new TextDecoder().decode(plaintext);
}

/**
 * Resolve the note key for a caller without ever rotating an existing one.
 *
 * Injected API functions keep this pure and unit-testable:
 *   getKey()        -> GET /keys/:noteId response
 *   listPublicKeys() -> GET /public-keys/:noteId response
 *   storeRecipients(recipients) -> POST /keys/:noteId/recipients response
 *
 * Returns the note key hex, or null (never provision/rotate on ambiguity).
 */
/**
 * Try each envelope with the local private key; return the first that unwraps
 * to a valid note key. Caches the result against `noteId`.
 */
export async function recoverNoteKeyFromEnvelopes(envelopes, identity, noteId, _log = console) {
  for (const env of envelopes || []) {
    const wrappedKey = env?.wrappedKey ?? env;
    if (!wrappedKey) continue;
    try {
      const k = await unwrapNoteKey(identity.privateKeyHex, wrappedKey);
      if (k && isValidCollabKey(k)) {
        if (noteId) unwrappedKeyCache.set(noteId, k);
        return k;
      }
    } catch {
      // envelope not for this device — try the next one
    }
  }
  return null;
}

export async function provisionNoteKey({ getKey, listPublicKeys, storeRecipients, identity, noteId, log = console }) {
  if (noteId && unwrappedKeyCache.has(noteId)) {
    return unwrappedKeyCache.get(noteId);
  }

  let raw;
  try {
    raw = await getKey();
  } catch (err) {
    log.warn?.('[provisionNoteKey] getKey failed:', err);
    return null;
  }

  // Contract drift: a legacy `key` shape, or a response missing `noteHasKey`
  // entirely, means the note may already have a key. Never rotate on ambiguity.
  if (raw?.key !== undefined && raw?.wrappedKey === undefined) {
    log.warn?.('[provisionNoteKey] legacy key shape; refusing to rotate an existing note key');
    return null;
  }
  if (raw?.noteHasKey === undefined) {
    log.warn?.('[provisionNoteKey] ambiguous note-key shape (missing noteHasKey); refusing to rotate');
    return null;
  }

  // 1. The note already has a key. Recover this caller's envelope, if any.
  if (raw?.noteHasKey === true) {
    if (raw?.wrappedKey) {
      try {
        const noteKeyHex = await unwrapNoteKey(identity.privateKeyHex, raw.wrappedKey);
        if (noteKeyHex && isValidCollabKey(noteKeyHex)) {
          if (noteId) unwrappedKeyCache.set(noteId, noteKeyHex);
          return noteKeyHex;
        }
      } catch (err) {
        log.warn?.('[provisionNoteKey] failed to unwrap note key envelope:', err);
      }
    }
    // Late joiner (or unwrap failure): no usable envelope for this caller.
    // Do NOT provision/rotate — an owner must re-wrap the existing key for us.
    return null;
  }

  // 2. Fresh note — provision a new note key for every keypair'd collaborator
  //    (the owner is part of the collaborator set).
  try {
    const publicKeys = await listPublicKeys();
    const keypairCollabs = Array.isArray(publicKeys?.collaborators)
      ? publicKeys.collaborators.filter((c) => c?.kemPublicKey)
      : [];
    if (keypairCollabs.length === 0) return null;

    const noteKeyHex = await bytesToHex(crypto.getRandomValues(new Uint8Array(32)));
    const recipients = [];
    for (const c of keypairCollabs) {
      const wrappedKey = await wrapNoteKeyForRecipient(c.kemPublicKey, noteKeyHex);
      recipients.push({ userId: c.userId, deviceId: c.deviceId || 'default', wrappedKey });
    }
    const stored = await storeRecipients(recipients);

    // Concurrent provisioning: another client won the race and the server
    // refused our envelopes. Recover the winner's key instead of diverging.
    if (stored?.existing) {
      try {
        const winner = await getKey();
        const winnerKey = await recoverNoteKeyFromEnvelopes(
          winner?.wrappedKeys || (winner?.wrappedKey ? [winner] : []),
          identity,
          noteId,
          log
        );
        if (winnerKey) return winnerKey;
      } catch (err) {
        log.warn?.('[provisionNoteKey] failed to recover concurrently-provisioned note key:', err);
      }
      return null;
    }

    if (noteId) unwrappedKeyCache.set(noteId, noteKeyHex);
    return noteKeyHex;
  } catch (err) {
    log.warn?.('[provisionNoteKey] note-key provisioning failed:', err);
    return null;
  }
}
