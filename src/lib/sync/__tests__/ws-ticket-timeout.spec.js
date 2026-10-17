import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Regression: the ws-ticket fetch was issued with no signal, no timeout and no
// credentials. A hung fetch left `pendingRooms` holding the room forever, so the
// join could never retry — not on rejoin, not on leave, not after disconnect().

const mocks = vi.hoisted(() => ({
  providerCount: 0,
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
vi.mock('@/store/note', () => ({
  useNoteStore: vi.fn(() => ({ data: {} })),
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
vi.mock('@/lib/api/workspaces', () => ({
  getWorkspaceKey: vi.fn(async () => null),
  getCachedWorkspaceKey: vi.fn(() => 'ab'.repeat(32)),
  recoverWorkspaceKeyHex: vi.fn(async () => null),
  clearWorkspaceKeyCache: vi.fn(),
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
      this.synced = false
      this.wsconnected = false
      this.awareness = { getStates: () => new Map(), setLocalState: vi.fn() }
      void options
    }
    connect() { this.wsconnected = true; this.emit('status', { status: 'connected' }) }
    disconnect() { this.wsconnected = false }
    destroy() {}
  }
  return { WebsocketProvider: MockWebsocketProvider }
})

import { getWsSync, setRoomKey } from '../ws-sync.js'

const roomFor = (noteId) => `workspace:ws-1:note:${noteId}`
const realTimeout = AbortSignal.timeout.bind(AbortSignal)

// Each test uses its own note so a stuck room from an earlier test cannot
// masquerade as the next test's result.
describe('ws-sync ws-ticket request bounds', () => {
  let fetchCalls
  let ticketInits
  let timeoutSpy

  beforeEach(() => {
    mocks.providerCount = 0
    fetchCalls = []
    ticketInits = []
    getWsSync().disconnect()
    vi.stubGlobal('fetch', vi.fn((url, init) => {
      fetchCalls.push(url)
      ticketInits.push(init)
      // Never answer, like a stalled relay — but honour the abort, like fetch.
      // With no signal at all nothing can cancel it, which is the defect.
      return new Promise((_, reject) => {
        if (!init.signal) return
        const abort = () =>
          reject(init.signal.reason ?? new DOMException('aborted', 'AbortError'))
        if (init.signal.aborted) abort()
        else init.signal.addEventListener('abort', abort, { once: true })
      })
    }))
    // Shorten the product timeout so the test does not wait the real 15s.
    timeoutSpy = vi
      .spyOn(AbortSignal, 'timeout')
      .mockImplementation(() => realTimeout(5))
  })

  afterEach(() => {
    timeoutSpy.mockRestore()
    vi.unstubAllGlobals()
  })

  it('CONTROL: the ticket request itself is correct', async () => {
    const noteId = 'note-control'
    await setRoomKey(roomFor(noteId), 'ab'.repeat(32))
    getWsSync().joinNoteRoom(noteId, { on: vi.fn(), off: vi.fn() })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(fetchCalls).toEqual(['http://localhost:4000/auth/ws-ticket'])
    expect(ticketInits[0].headers.Authorization).toBe('Bearer mock-token')
    expect(JSON.parse(ticketInits[0].body)).toEqual({ workspaceId: 'ws-1', noteId })
  })

  it('gives the ws-ticket fetch a bounded signal', async () => {
    const noteId = 'note-signal'
    await setRoomKey(roomFor(noteId), 'ab'.repeat(32))
    getWsSync().joinNoteRoom(noteId, { on: vi.fn(), off: vi.fn() })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(ticketInits[0].signal).toBeInstanceOf(AbortSignal)
  })

  it('a hung ticket fetch cannot pin the room join forever', async () => {
    const noteId = 'note-unpin'
    await setRoomKey(roomFor(noteId), 'ab'.repeat(32))
    await getWsSync().joinNoteRoom(noteId, { on: vi.fn(), off: vi.fn() })
    expect(mocks.providerCount).toBe(1)
  })

  it('a room can rejoin after leave once the ticket fetch settles', async () => {
    const noteId = 'note-rejoin'
    await setRoomKey(roomFor(noteId), 'ab'.repeat(32))
    getWsSync().leaveNoteRoom(noteId)
    await getWsSync().joinNoteRoom(noteId, { on: vi.fn(), off: vi.fn() })
    await getWsSync().leaveNoteRoom(noteId)
    getWsSync().joinNoteRoom(noteId, { on: vi.fn(), off: vi.fn() })
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(fetchCalls.length).toBe(2)
  })
})

