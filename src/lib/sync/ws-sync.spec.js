import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock dependencies
vi.mock('@/store/account', () => ({
  useAccountStore: vi.fn(() => ({
    token: 'mock-token',
    status: 'authenticated',
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
  useCollaboratorStore: vi.fn(() => ({
    noteId: '',
    collaborators: [],
  })),
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
  importCollabKey: vi.fn(),
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
  getWorkspaceKey: vi.fn(),
  getCachedWorkspaceKey: vi.fn(() => 'b'.repeat(64)),
}))
vi.mock('@/utils/permissions', () => ({
  ROLES: { OWNER: 'owner', EDITOR: 'editor', VIEWER: 'viewer', GUEST: 'guest' },
  canEdit: (role) => role === 'owner' || role === 'editor',
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
    connect() {
      this.wsconnected = true
      this.emit('status', { status: 'connected' })
    }
    disconnect() {
      this.wsconnected = false
    }
    destroy() {}
  }
  return { WebsocketProvider: MockWebsocketProvider }
})

import { getWsSync } from './ws-sync.js'
import { useAccountStore } from '@/store/account'
import { useWorkspaceStore } from '@/store/workspace'
import { useCollaboratorStore } from '@/store/collaborator'

describe('ws-sync', () => {
  beforeEach(() => {
    useAccountStore.mockReturnValue({
      token: 'mock-token',
      status: 'authenticated',
      profile: { id: 'user-1', username: 'testuser' },
    })
    useWorkspaceStore.mockReturnValue({
      activeId: 'ws-1',
      workspaces: [{ id: 'ws-1', role: 'editor' }],
      activeWorkspace: { id: 'ws-1', role: 'editor' },
    })
    useCollaboratorStore.mockReturnValue({ noteId: '', collaborators: [] })
  })
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

  it('getRoomRole returns editor for editable workspace role', () => {
    const sync = getWsSync()
    expect(sync.getRoomRole('note-1')).toBe('editor')
  })

  it('getRoomRole ignores stale collaborator state from another note', () => {
    useWorkspaceStore.mockReturnValue({ activeWorkspace: null })
    useCollaboratorStore.mockReturnValue({ noteId: 'old-note', collaborators: [] })
    const sync = getWsSync()
    expect(sync.getRoomRole('new-note')).toBe('editor')
  })

  it('getRoomRole returns editor for local notes without an account', () => {
    useAccountStore.mockReturnValue({ token: null, status: 'guest', profile: null })
    useWorkspaceStore.mockReturnValue({ activeWorkspace: null })
    const sync = getWsSync()
    expect(sync.getRoomRole('local-note')).toBe('editor')
  })

  it('getRoomRole stays viewer when this note is shared but we are not listed', () => {
    useWorkspaceStore.mockReturnValue({ activeWorkspace: null })
    useCollaboratorStore.mockReturnValue({
      noteId: 'shared-note',
      collaborators: [{ userId: 'user-2', username: 'other', role: 'editor' }],
    })
    const sync = getWsSync()
    expect(sync.getRoomRole('shared-note')).toBe('viewer')
  })

  it('getRoomRole returns our collaborator role for this note', () => {
    useWorkspaceStore.mockReturnValue({ activeWorkspace: null })
    useCollaboratorStore.mockReturnValue({
      noteId: 'shared-note',
      collaborators: [{ userId: 'user-1', username: 'testuser', role: 'viewer' }],
    })
    const sync = getWsSync()
    expect(sync.getRoomRole('shared-note')).toBe('viewer')
  })
})