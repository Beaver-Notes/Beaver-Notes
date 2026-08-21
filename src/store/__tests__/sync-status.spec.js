import { describe, it, expect } from 'vitest'
import { describeStatus } from '../sync-progress'

describe('describeStatus', () => {
  it('classifies transient states quietly', () => {
    expect(describeStatus('retrying')).toEqual({ tone: 'transient', text: 'Retrying…' })
    expect(describeStatus('offline')).toEqual({ tone: 'transient', text: 'Offline — will retry automatically' })
  })

  it('classifies action-required states with plain causes', () => {
    expect(describeStatus('unlock-required'))
      .toEqual({ tone: 'action', text: 'Notes are locked — unlock to sync' })
    expect(describeStatus('authorization-failed'))
      .toEqual({ tone: 'action', text: 'Session expired — sign in again' })
    expect(describeStatus('workspace-reset'))
      .toEqual({ tone: 'action', text: 'Workspace was reset on the server' })
    expect(describeStatus('decrypt-failed', 'bad envelope'))
      .toEqual({ tone: 'action', text: 'Couldn’t decrypt an update — bad envelope' })
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
