import { encryptUpdate, decryptUpdate } from './collab.js'
import * as Y from 'yjs'

const TYPE_STRING = 0x01
const TYPE_BINARY = 0x02

/**
 * Encrypt a value for a specific Y.Map key.
 * Uses AES-256-GCM via existing collab.js infrastructure.
 * Prepends a 1-byte type tag so decryptMapValue can restore the original type.
 *
 * @param {CryptoKey} key - AES-256-GCM collaboration key
 * @param {string} mapKey - Y.Map key (used as AAD for authentication)
 * @param {string|Uint8Array} value - Plaintext value to encrypt
 * @returns {Promise<Uint8Array>} Encrypted value (IV + ciphertext)
 */
export async function encryptMapValue(key, mapKey, value) {
  const isString = typeof value === 'string'
  const raw = isString
    ? new TextEncoder().encode(value)
    : value
  const tagged = new Uint8Array(1 + raw.length)
  tagged[0] = isString ? TYPE_STRING : TYPE_BINARY
  tagged.set(raw, 1)
  return encryptUpdate(key, tagged, mapKey)
}

/**
 * Decrypt a value from a specific Y.Map key.
 * Reads the 1-byte type tag to return string or Uint8Array as originally encrypted.
 *
 * @param {CryptoKey} key - AES-256-GCM collaboration key
 * @param {string} mapKey - Y.Map key (must match encryption AAD)
 * @param {Uint8Array} encrypted - IV + ciphertext from encryptMapValue
 * @returns {Promise<string|Uint8Array>} Decrypted value matching original type
 */
export async function decryptMapValue(key, mapKey, encrypted) {
  const decrypted = await decryptUpdate(key, encrypted, mapKey)
  const typeTag = decrypted[0]
  const payload = decrypted.slice(1)
  if (typeTag === TYPE_STRING) {
    return new TextDecoder().decode(payload)
  }
  return payload
}

/**
 * Create a clone of a Y.Doc with specified map values encrypted.
 * Used before sending updates to the relay server.
 *
 * @param {Y.Doc} doc - Source document
 * @param {CryptoKey} key - Encryption key
 * @param {string[]} mapKeys - Y.Map keys to encrypt
 * @returns {Promise<Y.Doc>} New doc with encrypted values
 */
export async function wrapYDocForRelay(doc, key, mapKeys) {
  const clone = Y.encodeStateAsUpdate(doc)
  const newDoc = new Y.Doc()
  Y.applyUpdate(newDoc, clone)

  const map = newDoc.getMap('note')
  for (const mk of mapKeys) {
    const val = map.get(mk)
    if (typeof val === 'string') {
      const encrypted = await encryptMapValue(key, mk, val)
      map.set(mk, encrypted)
    }
  }
  return newDoc
}

/**
 * Decrypt specified map values in a Y.Doc.
 * Used after receiving updates from the relay server.
 *
 * @param {Y.Doc} doc - Document with encrypted values
 * @param {CryptoKey} key - Decryption key
 * @param {string[]} mapKeys - Y.Map keys to decrypt
 * @returns {Promise<Y.Doc>} Doc with decrypted values
 */
export async function unwrapYDocFromRelay(doc, key, mapKeys) {
  const map = doc.getMap('note')
  for (const mk of mapKeys) {
    const val = map.get(mk)
    if (val instanceof Uint8Array) {
      try {
        const decrypted = await decryptMapValue(key, mk, val)
        map.set(mk, decrypted)
      } catch (err) {
        console.warn(`[content-encrypt] failed to decrypt ${mk}:`, err.message)
      }
    }
  }
  return doc
}
