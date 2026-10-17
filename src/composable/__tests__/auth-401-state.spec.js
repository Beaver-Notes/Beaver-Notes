import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

// account-storage encrypts the session token through the native security bridge.
const blobs = new Map()
vi.mock('@/lib/native/security', () => ({
  isEncryptionAvailable: async () => true,
  encryptString: async (v) => v,
  decryptString: async (v) => v,
  setDevicePassword: async () => true,
  setSecureBlob: async (k, v) => { blobs.set(k, v) },
  getSecureBlob: async (k) => blobs.get(k) ?? null,
  clearSecureBlob: async (k) => { blobs.delete(k) },
}))

// A 401 from the configured server is authoritative: the session is dead. client.js
// clears the persisted token, but fetchProfile kept the in-memory one, so the app
// rendered "signed in" while every REST call went anonymous and ws-sync (which reads
// the store) kept presenting the dead bearer token. One 401, one auth state.
describe('401 handling leaves one auth state, not two', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.resetModules()
  })

  it('a 401 from the profile endpoint clears both the store token and the persisted one', async () => {
    // Stub fetch, not the api module: client.js is the layer that clears the
    // persisted token on a 401, so it has to run for this to mean anything.
    const realFetch = globalThis.fetch
    globalThis.fetch = async () => new Response('{}', { status: 401, headers: { 'content-type': 'application/json' } })

    const { useAccountAuth } = await import('@/composable/useAccountAuth')
    const { useAccountStore } = await import('@/store/account')
    const storage = await import('@/lib/account-storage')

    const store = useAccountStore()
    store.setStatus('authenticated')
    store.setToken('live-token')
    await storage.saveSessionToken('live-token')

    try {
      const { refreshProfile } = useAccountAuth()
      await refreshProfile()
    } finally {
      globalThis.fetch = realFetch
    }

    expect(store.status).toBe('anonymous')
    expect(store.token).toBe(null)
    expect(await storage.loadSessionToken()).toBe(null)
  })

  it('CONTROL: a non-401 failure leaves the account signed in', async () => {
    const realFetch = globalThis.fetch
    globalThis.fetch = async () => new Response('{}', { status: 503, headers: { 'content-type': 'application/json' } })

    const { useAccountAuth } = await import('@/composable/useAccountAuth')
    const { useAccountStore } = await import('@/store/account')
    const storage = await import('@/lib/account-storage')

    const store = useAccountStore()
    store.setStatus('authenticated')
    store.setToken('live-token')
    await storage.saveSessionToken('live-token')

    try {
      const { refreshProfile } = useAccountAuth()
      await refreshProfile()
    } finally {
      globalThis.fetch = realFetch
    }

    expect(store.status).toBe('authenticated')
    expect(store.token).toBe('live-token')
    expect(await storage.loadSessionToken()).toBe('live-token')
  })
})
