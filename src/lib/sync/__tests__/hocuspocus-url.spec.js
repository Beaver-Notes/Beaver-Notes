import { describe, it, expect, vi, beforeEach } from 'vitest'

function setupEnv(env = {}) {
  vi.stubEnv('VITE_BEAVER_SYNC_WS_URL', env.VITE_BEAVER_SYNC_WS_URL ?? '')
  vi.stubEnv('VITE_HOCUSPOCUS_URL', env.VITE_HOCUSPOCUS_URL ?? '')
  vi.stubEnv(
    'VITE_BEAVER_SYNC_API_URL',
    env.VITE_BEAVER_SYNC_API_URL ?? '',
  )
}

describe('getWebSocketUrl', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.unstubAllEnvs()
  })

  it('uses VITE_BEAVER_SYNC_WS_URL directly when set', async () => {
    setupEnv({ VITE_BEAVER_SYNC_WS_URL: 'wss://custom.example.com/ws' })
    const { getWebSocketUrl } = await import('../ws-sync.js')
    expect(getWebSocketUrl()).toBe('wss://custom.example.com/ws')
  })

  it('uses VITE_HOCUSPOCUS_URL directly when set', async () => {
    setupEnv({ VITE_HOCUSPOCUS_URL: 'wss://hocus.example.com' })
    const { getWebSocketUrl } = await import('../ws-sync.js')
    expect(getWebSocketUrl()).toBe('wss://hocus.example.com')
  })

  it('strips trailing slashes from explicit WS URL', async () => {
    setupEnv({ VITE_BEAVER_SYNC_WS_URL: 'wss://custom.example.com///' })
    const { getWebSocketUrl } = await import('../ws-sync.js')
    expect(getWebSocketUrl()).toBe('wss://custom.example.com')
  })

  it('derives wss:// from https API URL', async () => {
    setupEnv({ VITE_BEAVER_SYNC_API_URL: 'https://sync.example.com' })
    const { getWebSocketUrl } = await import('../ws-sync.js')
    expect(getWebSocketUrl()).toBe('wss://sync.example.com')
  })

  it('derives ws:// from http API URL with port', async () => {
    setupEnv({ VITE_BEAVER_SYNC_API_URL: 'http://localhost:4000' })
    const { getWebSocketUrl } = await import('../ws-sync.js')
    expect(getWebSocketUrl()).toBe('ws://localhost:4000')
  })

  it('falls back to ws://localhost:8080 on invalid URL', async () => {
    setupEnv({ VITE_BEAVER_SYNC_API_URL: 'not-a-url' })
    const { getWebSocketUrl } = await import('../ws-sync.js')
    expect(getWebSocketUrl()).toBe('ws://localhost:8080')
  })
})
