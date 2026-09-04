import { encryptUpdate, decryptUpdate } from './collab.js'
import * as Y from 'yjs'

const TYPE_STRING = 0x01
const TYPE_BINARY = 0x02

/**
 * Encrypt a Y.Map value with AES-256-GCM (via collab.js): a 1-byte type tag
 * is prepended so the original type can be restored, and mapKey is the AAD.
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

/** Inverse of encryptMapValue: mapKey must match encryption AAD. */
export async function decryptMapValue(key, mapKey, encrypted) {
  const decrypted = await decryptUpdate(key, encrypted, mapKey)
  const typeTag = decrypted[0]
  const payload = decrypted.slice(1)
  if (typeTag === TYPE_STRING) {
    return new TextDecoder().decode(payload)
  }
  return payload
}

/** Clone a Y.Doc with the given map values encrypted, before sending to the relay. */
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
