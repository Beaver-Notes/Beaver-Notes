import { createMlKem768 } from 'mlkem';
import { importCollabKey } from './collab.js';

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
