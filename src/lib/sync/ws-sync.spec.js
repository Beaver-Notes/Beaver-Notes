import { describe, it, expect, vi } from 'vitest'

// Mock dependencies
vi.mock('@/store/account', () => ({
  useAccountStore: vi.fn(() => ({ token: 'mock-token', status: 'authenticated' }))
}))
vi.mock('@/store/workspace', () => ({
  useWorkspaceStore: vi.fn(() => ({ activeId: 'ws-1', workspaces: [] }))
}))
vi.mock('@/lib/yjs/meta-doc', () => ({
  getWorkspaceDoc: vi.fn(() => ({ on: vi.fn(), off: vi.fn() }))
}))
vi.mock('@/lib/yjs/shared', () => ({
  registerActiveDoc: vi.fn(),
  unregisterActiveDoc: vi.fn()
}))
vi.mock('@/utils/crypto/collab', () => ({
  importCollabKey: vi.fn(),
  encryptUpdate: vi.fn(),
  decryptUpdate: vi.fn(),
  isValidCollabKey: vi.fn(() => true)
}))
vi.mock('@/utils/crypto/note-key', () => ({
  clearUnwrappedKeyCache: vi.fn(),
  unwrapNoteKey: vi.fn()
}))
vi.mock('@/utils/crypto/identity', () => ({
  loadOrCreateIdentity: vi.fn(() => Promise.resolve({ privateKeyHex: 'a'.repeat(64) }))
}))
vi.mock('@/lib/api/workspaces', () => ({
  getWorkspaceKey: vi.fn(),
  getCachedWorkspaceKey: vi.fn(() => 'b'.repeat(64))
}))
vi.mock('y-websocket', () => {
  const { EventEmitter } = require('events')
  class MockWebsocketProvider extends EventEmitter {
    constructor() {
      super()
      this.synced = false
      this.wsconnected = false
      this.awareness = { getStates: () => new Map(), setLocalState: vi.fn() }
    }
    connect() { this.wsconnected = true; this.emit('status', { status: 'connected' }) }
    disconnect() { this.wsconnected = false }
    destroy() {}
  }
  return { WebsocketProvider: MockWebsocketProvider }
})

import { getWsSync } from './ws-sync.js'

describe('ws-sync', () => {
  it('creates a singleton instance', () => {
    const a = getWsSync()
    const b = getWsSync()
    expect(a).toBe(b)
  })

  it('exports expected API methods', () => {
    const sync = getWsSync()
    expect(typeof sync.start).toBe('function')
    expect(typeof sync.stop).toBe('function')
    expect(typeof sync.connect).toBe('function')
    expect(typeof sync.disconnect).toBe('function')
    expect(typeof sync.joinNoteRoom).toBe('function')
    expect(typeof sync.leaveNoteRoom).toBe('function')
    expect(typeof sync.joinMetaRoom).toBe('function')
    expect(typeof sync.handleWorkspaceSwitch).toBe('function')
    expect(typeof sync.handleNoteSwitch).toBe('function')
    expect(typeof sync.getRoomRole).toBe('function')
  })
})
