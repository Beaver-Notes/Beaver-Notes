import { describe, it, expect } from 'vitest'
import * as Y from 'yjs'
import { encryptMapValue, decryptMapValue, wrapYDocForRelay, unwrapYDocFromRelay } from '../crypto/content-encrypt.js'

async function makeKey() {
  const raw = crypto.getRandomValues(new Uint8Array(32))
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
}

describe('content-encrypt', () => {
  describe('encryptMapValue / decryptMapValue', () => {
    it('round-trips a string value', async () => {
      const key = await makeKey()
      const plain = 'Hello, world!'
      const encrypted = await encryptMapValue(key, 'title', plain)
      expect(encrypted).not.toBe(plain)
      const decrypted = await decryptMapValue(key, 'title', encrypted)
      expect(decrypted).toBe(plain)
    })

    it('round-trips binary data', async () => {
      const key = await makeKey()
      const data = new Uint8Array([1, 2, 3, 4, 5])
      const encrypted = await encryptMapValue(key, 'content', data)
      const decrypted = await decryptMapValue(key, 'content', encrypted)
      expect(decrypted).toEqual(data)
    })

    it('different map keys produce different ciphertext for same value', async () => {
      const key = await makeKey()
      const plain = 'test'
      const enc1 = await encryptMapValue(key, 'key1', plain)
      const enc2 = await encryptMapValue(key, 'key2', plain)
      expect(enc1).not.toEqual(enc2)
    })
  })

  describe('wrapYDocForRelay / unwrapYDocFromRelay', () => {
    it('encrypts specified map keys and decrypts them back', async () => {
      const key = await makeKey()
      const doc = new Y.Doc()
      const map = doc.getMap('note')
      map.set('title', 'My Note')
      map.set('content', '<p>Hello</p>')
      map.set('id', 'note-123')

      const encrypted = await wrapYDocForRelay(doc, key, ['title', 'content'])
      const titleVal = encrypted.getMap('note').get('title')
      expect(titleVal).toBeInstanceOf(Uint8Array)
      expect(titleVal).not.toBe('My Note')

      expect(encrypted.getMap('note').get('id')).toBe('note-123')

      const decrypted = await unwrapYDocFromRelay(encrypted, key, ['title', 'content'])
      expect(decrypted.getMap('note').get('title')).toBe('My Note')
      expect(decrypted.getMap('note').get('content')).toBe('<p>Hello</p>')
      expect(decrypted.getMap('note').get('id')).toBe('note-123')
    })
  })
})
