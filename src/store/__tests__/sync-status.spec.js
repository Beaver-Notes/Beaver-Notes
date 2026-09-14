import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { describeStatus, useSyncProgressStore } from '../sync-progress'

const mocks = vi.hoisted(() => ({
  statusListeners: new Map(),
}))

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn((event, handler) => {
    mocks.statusListeners.set(event, handler)
    return Promise.resolve(() => mocks.statusListeners.delete(event))
  }),
}))

vi.mock('@/lib/native/app', () => ({
  notify: vi.fn(() => Promise.resolve()),
}))

describe('describeStatus', () => {
  it('classifies transient states quietly', () => {
    expect(describeStatus('retrying')).toEqual({ tone: 'transient', text: 'Retrying…' })
    expect(describeStatus('offline')).toEqual({ tone: 'transient', text: 'Offline. Will retry automatically.' })
  })

  it('classifies action-required states with plain causes', () => {
    expect(describeStatus('unlock-required'))
      .toEqual({ tone: 'action', text: 'Notes are locked. Unlock to sync.' })
    expect(describeStatus('authorization-failed'))
      .toEqual({ tone: 'action', text: 'Session expired. Sign in again.' })
    expect(describeStatus('workspace-reset'))
      .toEqual({ tone: 'action', text: 'Workspace was reset on the server' })
    expect(describeStatus('decrypt-failed', 'bad envelope'))
      .toEqual({ tone: 'action', text: 'Couldn’t decrypt an update: bad envelope' })
  })

  it('returns null tone for routine states', () => {
    expect(describeStatus('syncing').tone).toBeNull()
    expect(describeStatus('complete').tone).toBeNull()
    expect(describeStatus('idle').tone).toBeNull()
    expect(describeStatus('unknown-status').tone).toBeNull()
  })

  it('uses the engine-provided message verbatim when present for action states', () => {
    expect(describeStatus('authorization-failed', 'token revoked').text).toBe('token revoked')
  })
})

function makeStore() {
  const store = useSyncProgressStore()
  store.startListening()
  return store
}

function emitStatus(payload) {
  const handler = mocks.statusListeners.get('sync:status')
  if (!handler) throw new Error('sync:status listener not registered')
  handler({ payload })
}

describe('sync progress store action persistence', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    mocks.statusListeners.clear()
  })

  it('keeps lastAction visible when unlock-required is followed by complete', () => {
    const store = makeStore()
    emitStatus({ status: 'unlock-required' })
    expect(store.lastAction).not.toBeNull()
    emitStatus({ status: 'complete' })
    expect(store.lastAction).not.toBeNull()
    expect(store.attention)
      .toEqual({ tone: 'action', text: 'Notes are locked. Unlock to sync.', status: 'unlock-required' })
  })

  it('keeps showing the pending action while transient statuses come and go', () => {
    const store = makeStore()
    emitStatus({ status: 'decrypt-failed', message: 'bad envelope' })
    expect(store.attention.tone).toBe('action')
    for (const transient of ['offline', 'retrying', 'syncing']) {
      emitStatus({ status: transient })
      expect(store.attention.tone).toBe('action')
      expect(store.attention.status).toBe('decrypt-failed')
      expect(store.attention.text).toBe('Couldn’t decrypt an update: bad envelope')
    }
  })

  it('dismissError clears the persisted action', () => {
    const store = makeStore()
    emitStatus({ status: 'unlock-required' })
    emitStatus({ status: 'complete' })
    expect(store.attention.tone).toBe('action')
    store.dismissError()
    expect(store.lastAction).toBeNull()
    expect(store.attention).toBeNull()
  })

  it('a new action-class status replaces the previous one', () => {
    const store = makeStore()
    emitStatus({ status: 'unlock-required' })
    emitStatus({ status: 'authorization-failed', message: 'token revoked' })
    expect(store.lastAction.status).toBe('authorization-failed')
    expect(store.attention)
      .toEqual({ tone: 'action', text: 'token revoked', status: 'authorization-failed' })
  })
})
