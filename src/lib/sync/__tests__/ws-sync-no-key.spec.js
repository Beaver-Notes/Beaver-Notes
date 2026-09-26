import { describe, it, expect, vi, beforeEach } from 'vitest'

// Realtime is an accelerator, never a prerequisite: with no provisioned room
// key the provider must not be constructed at all (no plaintext fallback), and
// the durable Rust path must still be kicked.

const mocks = vi.hoisted(() => ({
  providerCount: 0,
  providerOptions: [],
  kickRustSync: vi.fn(),
}))

vi.mock('@/store/account', () => ({
  useAccountStore: vi.fn(() => ({
    token: 'mock-token',
    status: 'authenticated',
    serverUrl: 'http://localhost:4000',
    profile: { id: 'user-1', username: 'testuser' },
  })),
}))
vi.mock('@/store/workspace', () => ({
  useWorkspaceStore: vi.fn(() => ({
    activeId: 'ws-1',
    workspaces: [{ id: 'ws-1', role: 'editor' }],
    activeWorkspace: { id: 'ws-1', role: 'editor' },
  })),
}))
vi.mock('@/store/collaborator', () => ({
  useCollaboratorStore: vi.fn(() => ({ noteId: '', collaborators: [] })),
}))
vi.mock('y-protocols/awareness', () => ({
  Awareness: class { constructor(doc) { this.doc = doc } },
}))
vi.mock('@/lib/yjs/meta-doc', () => ({
  getWorkspaceDoc: vi.fn(() => ({ on: vi.fn(), off: vi.fn() })),
  onWorkspaceDocDestroy: vi.fn(),
}))
vi.mock('@/lib/yjs/shared', () => ({
  registerActiveDoc: vi.fn(),
  unregisterActiveDoc: vi.fn(),
}))
vi.mock('@/utils/crypto/collab', () => ({
  importCollabKey: vi.fn(async () => ({ fake: 'key' })),
  encryptUpdate: vi.fn(),
  decryptUpdate: vi.fn(),
  isValidCollabKey: vi.fn(() => true),
}))
vi.mock('@/utils/crypto/note-key', () => ({
  clearUnwrappedKeyCache: vi.fn(),
  unwrapNoteKey: vi.fn(),
}))
vi.mock('@/utils/crypto/identity', () => ({
  loadOrCreateIdentity: vi.fn(() => Promise.resolve({ privateKeyHex: 'a'.repeat(64) })),
}))
// No cached/incoming workspace key: the meta room stays unkeyed too.
vi.mock('@/lib/api/workspaces', () => ({
  getWorkspaceKey: vi.fn(async () => null),
  getCachedWorkspaceKey: vi.fn(() => null),
  recoverWorkspaceKeyHex: vi.fn(async () => null),
}))
vi.mock('@/utils/permissions', () => ({
  ROLES: { OWNER: 'owner', EDITOR: 'editor', VIEWER: 'viewer', GUEST: 'guest' },
  canEdit: (role) => role === 'owner' || role === 'editor',
}))
vi.mock('@/utils/sync/rust-shim.js', () => ({
  kickRustSync: mocks.kickRustSync,
}))
vi.mock('@/utils/sync/shared-keys.js', () => ({
  registerSharedSyncKey: vi.fn(async () => true),
  clearSharedSyncKeys: vi.fn(async () => {}),
  expectSharedSyncNote: vi.fn(async () => true),
}))
vi.mock('y-websocket', () => {
  const { EventEmitter } = require('events')
  class MockWebsocketProvider extends EventEmitter {
    constructor(_url, _room, _doc, options) {
      super()
      mocks.providerCount += 1
      mocks.providerOptions.push(options)
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

import { getWsSync, setRoomKey } from '../ws-sync.js'
import { getCachedWorkspaceKey } from '@/lib/api/workspaces'

const NOTE_ROOM = 'workspace:ws-1:note:note-1'

describe('ws-sync room-key gate', () => {
  beforeEach(() => {
    mocks.providerCount = 0
    mocks.providerOptions = []
    mocks.kickRustSync.mockClear()
    getCachedWorkspaceKey.mockReturnValue(null)
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false })))
    getWsSync().disconnect()
  })

  it('does not open a note-room socket without a key, and kicks durable sync', async () => {
    const doc = { on: vi.fn(), off: vi.fn() }
    await getWsSync().joinNoteRoom('note-1', doc)

    expect(mocks.providerCount).toBe(0)
    expect(mocks.kickRustSync).toHaveBeenCalled()
  })

  it('joins on a later attempt once the key arrives (self-healing)', async () => {
    const doc = { on: vi.fn(), off: vi.fn() }
    await getWsSync().joinNoteRoom('note-1', doc)
    expect(mocks.providerCount).toBe(0)

    await setRoomKey(NOTE_ROOM, 'ab'.repeat(32))
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(mocks.providerCount).toBe(1)
  })

  it('does not open a meta-room socket without a key', async () => {
    await getWsSync().joinMetaRoom('ws-1')

    expect(mocks.providerCount).toBe(0)
    expect(mocks.kickRustSync).toHaveBeenCalled()
  })

  it('disables the plaintext BroadcastChannel presence path', async () => {
    const doc = { on: vi.fn(), off: vi.fn() }
    await setRoomKey(NOTE_ROOM, 'ab'.repeat(32))
    await getWsSync().joinNoteRoom('note-1', doc)

    expect(mocks.providerCount).toBe(1)
    expect(mocks.providerOptions.at(-1)?.disableBc).toBe(true)
  })
})

describe('ws-sync re-arm after sign-out (L7)', () => {
  beforeEach(() => {
    mocks.providerCount = 0
    mocks.kickRustSync.mockClear()
    getCachedWorkspaceKey.mockReturnValue('ab'.repeat(32))
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false })))
    getWsSync().disconnect()
  })

  it('start() rejoins the meta room after a stop cleared all providers', async () => {
    getWsSync().start()
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(mocks.providerCount).toBe(1)
  })
})
