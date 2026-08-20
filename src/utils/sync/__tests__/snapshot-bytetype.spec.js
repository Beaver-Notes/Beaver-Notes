import { describe, test, expect, vi, beforeAll } from 'vitest';
import * as Y from 'yjs';

// Mirror the Rust sync crypto contract with WebCrypto AES-GCM.
// envelope = { v:5, meta, iv (b64), enc (b64) }; update returned as base64.
const KEY = new Uint8Array(32).fill(7);
let cryptoKey;

async function deriveKey() {
  if (!cryptoKey) {
    cryptoKey = await crypto.subtle.importKey(
      'raw', KEY, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']
    );
  }
  return cryptoKey;
}
const b64ToBytes = (b) => Uint8Array.from(atob(b), (c) => c.charCodeAt(0));
const bytesToB64 = (b) => btoa(String.fromCharCode(...b));

async function rustEncrypt(meta, dataB64, aad) {
  const k = await deriveKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const pt = b64ToBytes(dataB64);
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(aad) },
    k, pt
  );
  return JSON.stringify({
    v: 5, meta: JSON.parse(meta),
    iv: bytesToB64(iv), enc: bytesToB64(new Uint8Array(ct)),
  });
}
async function rustDecrypt(env, aad) {
  const e = JSON.parse(env);
  const k = await deriveKey();
  const iv = b64ToBytes(e.iv), ct = b64ToBytes(e.enc);
  const pt = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(aad) },
    k, ct
  );
  return { meta: e.meta, update: bytesToB64(new Uint8Array(pt)) };
}

vi.mock('@/utils/crypto/encryption.js', () => ({ isEncryptionEnabled: () => true }));
vi.mock('@/lib/native/security.js', () => ({
  syncEncryptPayload: (meta, data, aad) => rustEncrypt(meta, data, aad),
  syncDecryptBatch: (envs, aads) =>
    Promise.all(envs.map((e, i) => rustDecrypt(e, aads[i]).catch(() => null))),
  syncKeyReady: () => Promise.resolve(true),
}));

const { encryptJSON, decryptBatch } = await import('@/utils/sync/crypto.js');

describe('snapshot vs incremental byte-type consistency', () => {
  test('seed-style Array.from(state) and incremental Uint8Array both round-trip to identical Yjs bytes', async () => {
    const doc = new Y.Doc();
    doc.getText('content').insert(0, 'hello snapshot world');
    const state = Y.encodeStateAsUpdate(doc);
    doc.destroy();

    const noteId = 'n1';
    const ts = 12345;

    // SEED path: update passed as Array.from(state)
    const seedEnv = await encryptJSON(
      { device: 'A', ts, seq: 0, noteId, update: Array.from(state) },
      `${noteId}-${ts}`
    );
    // INCREMENTAL path: update passed as Uint8Array
    const incEnv = await encryptJSON(
      { device: 'A', ts, sequence: 1, noteId, update: state },
      `${noteId}-${ts}`
    );

    const [seedDec] = await decryptBatch([seedEnv], [`${noteId}-${ts}`]);
    const [incDec] = await decryptBatch([incEnv], [`${noteId}-${ts}`]);

    expect(seedDec.update).toBeInstanceOf(Uint8Array);
    expect(incDec.update).toBeInstanceOf(Uint8Array);
    expect(Array.from(seedDec.update)).toEqual(Array.from(state));
    expect(Array.from(incDec.update)).toEqual(Array.from(state));
    // Both paths must yield the SAME concrete bytes.
    expect(Array.from(incDec.update)).toEqual(Array.from(seedDec.update));

    // Core cross-device assertion: the decrypted snapshot decodes into a valid
    // Yjs doc on device B and reconstructs the original content (NOT garbage /
    // "Unknown content type"). This mirrors cross-device-decrypt.spec.js but
    // without a live backend.
    const docB = new Y.Doc();
    Y.applyUpdate(docB, seedDec.update);
    expect(docB.getText('content').toString()).toBe('hello snapshot world');

    const docB2 = new Y.Doc();
    Y.applyUpdate(docB2, incDec.update);
    expect(docB2.getText('content').toString()).toBe('hello snapshot world');
  });

  test('a corrupt (garbage) snapshot is rejected, not applied as Yjs', async () => {
    // Mirrors loadStateIntoDoc's probe guard: a base64 string / JSON / partial
    // blob must throw on applyUpdate instead of silently corrupting the doc.
    const doc = new Y.Doc();
    const garbage = new Uint8Array([1, 2, 3, 23, 99, 200]);
    expect(() => Y.applyUpdate(doc, garbage)).toThrow();
  });
});
