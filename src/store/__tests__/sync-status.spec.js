import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { describeStatus, isPlanUpgradeRequired, useSyncProgressStore } from '../sync-progress'
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
    expect(describeStatus('offline')).toEqual({
      tone: 'transient',
      text: 'Offline — changes are saved here and will sync later',
    })
  })

  it('maps the iCloud-pending and throttled engine states the Rust side emits', () => {
    expect(describeStatus('pending-icloud'))
      .toEqual({ tone: 'transient', text: 'Waiting for iCloud to finish downloading files…' })
    expect(describeStatus('throttled'))
      .toEqual({ tone: 'transient', text: 'Server is busy — retrying shortly' })
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

  it('classifies the free-plan upgrade block with a clear, actionable message', () => {
    expect(describeStatus('plan-upgrade-required'))
      .toEqual({ tone: 'action', text: 'Upgrade required to sync this workspace' })
    expect(isPlanUpgradeRequired('sync: cloud request failed with status 402 Payment Required')).toBe(true)
    expect(isPlanUpgradeRequired('{"error":"plan_upgrade_required"}')).toBe(true)
    expect(isPlanUpgradeRequired('sync: pull failed')).toBe(false)
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

function emitError(payload) {
  const handler = mocks.statusListeners.get('sync:error')
  if (!handler) throw new Error('sync:error listener not registered')
  handler({ payload })
}

describe('sync progress store action persistence', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    mocks.statusListeners.clear()
  })

  it('clears lastAction when a cycle completes successfully', () => {
    // The Rust scheduler only emits `complete` on a fully successful cycle
    // (a locked vault exits early with `unlock-required`), so a completed
    // cycle proves the earlier lock/decrypt/auth warning is resolved.
    const store = makeStore()
    emitStatus({ status: 'unlock-required' })
    expect(store.lastAction).not.toBeNull()
    expect(store.attention)
      .toEqual({ tone: 'action', text: 'Notes are locked. Unlock to sync.', status: 'unlock-required' })
    emitStatus({ status: 'complete' })
    expect(store.lastAction).toBeNull()
    expect(store.attention).toBeNull()
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
    emitStatus({ status: 'syncing' })
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

  it('surfaces a free-plan 402 as an upgrade action without an indefinite spinner', () => {
    const store = makeStore()
    emitStatus({ status: 'syncing' })
    emitError({ message: 'sync: push request: sync: cloud request failed with status 402 Payment Required' })

    expect(store.isSyncing).toBe(false)
    expect(store.attention)
      .toEqual({ tone: 'action', text: 'Upgrade required to sync this workspace', status: 'plan-upgrade-required' })

    // The engine keeps ticking into the same 402; a later "syncing" must not
    // re-arm the spinner over the persistent upgrade warning.
    emitStatus({ status: 'syncing' })
    expect(store.isSyncing).toBe(false)
    expect(store.attention.status).toBe('plan-upgrade-required')
  })

  it('surfaces an unexpected fatal sync error instead of dropping it', () => {
    const store = makeStore()
    emitStatus({ status: 'syncing' })
    emitError({ message: 'sync: cloud request failed with status 500' })

    expect(store.isSyncing).toBe(false)
    expect(store.attention).toEqual({
      tone: 'action',
      text: 'Sync stopped unexpectedly',
      status: 'sync-failed',
      detail: 'sync: cloud request failed with status 500',
    })
  })

  it('records the last successful sync time only when a cycle completes', () => {
    localStorage.clear()
    const store = makeStore()
    expect(store.lastSyncAt).toBe(0)

    emitStatus({ status: 'syncing' })
    emitError({ message: 'sync: pull failed' })
    expect(store.lastSyncAt).toBe(0)
    expect(store.lastAttemptFailed).toBe(true)

    const before = Date.now()
    emitStatus({ status: 'complete' })
    expect(store.lastSyncAt).toBeGreaterThanOrEqual(before)
    expect(localStorage.getItem('sync:lastRunAt')).toBe(String(store.lastSyncAt))
    expect(store.lastAttemptFailed).toBe(false)
  })
})

test('an oversized item surfaces a message instead of failing silently', () => {
  // The Rust push engine reports item-too-large rather than advancing past a
  // rejected row. Unmapped, the sync strip would show nothing at all.
  expect(describeStatus('item-too-large').text).toBe(
    'An update is too large to sync. Reduce the change and sync again.',
  );
  expect(describeStatus('item-too-large').tone).toBe('action');
});
