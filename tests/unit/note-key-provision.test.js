import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

// Mock modules before importing useCloudWorkspaces
const apiGetWorkspacePublicKeys = vi.fn()
const apiRecoverWorkspaceKeyHex = vi.fn()
const apiProvisionWorkspaceKey = vi.fn()
const loadOrCreateIdentity = vi.fn()
const wrapNoteKeyForRecipient = vi.fn()

vi.mock('@/lib/api/workspaces', () => ({
  getWorkspaces: vi.fn(),
  getWorkspacePublicKeys: (...a) => apiGetWorkspacePublicKeys(...a),
  recoverWorkspaceKeyHex: (...a) => apiRecoverWorkspaceKeyHex(...a),
  provisionWorkspaceKey: (...a) => apiProvisionWorkspaceKey(...a),
  createWorkspace: vi.fn(),
  deleteWorkspace: vi.fn(),
  addMember: vi.fn(),
  removeMember: vi.fn(),
  joinWorkspace: vi.fn(),
  getCachedWorkspaceKey: vi.fn(() => null),
}))

vi.mock('@/utils/crypto/identity', () => ({
  loadOrCreateIdentity: (...a) => loadOrCreateIdentity(...a),
  generateIdentity: vi.fn(),
  publishIdentity: vi.fn(),
}))

vi.mock('@/utils/crypto/note-key', () => ({
  wrapNoteKeyForRecipient: (...a) => wrapNoteKeyForRecipient(...a),
}))

vi.mock('@/store/account', () => ({
  useAccountStore: () => ({
    isAuthenticated: true,
    serverUrl: 'https://api.test',
    isPaidPlan: true,
    profile: { id: 'owner-1' },
    activeAccount: { organizations: [{ id: 'org-1' }] },
    activeOrgId: 'org-1',
  }),
}))

import { useCloudWorkspaces } from '@/composable/useCloudWorkspaces.js'

describe('member key provisioning', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    localStorage.clear() // fresh device: drop TOFU key pins between tests
    apiGetWorkspacePublicKeys.mockResolvedValue([
      { userId: 'owner-1', deviceId: 'dev-o', kemPublicKey: 'owner-pub-hex', hasEnvelope: true },
      { userId: 'm2', deviceId: 'dev-a', kemPublicKey: 'member-pub-hex', hasEnvelope: false },
      { userId: 'm2', deviceId: 'dev-b', kemPublicKey: 'member-pub-b', hasEnvelope: true },
    ])
    loadOrCreateIdentity.mockResolvedValue({ publicKeyHex: 'owner-pub-hex', privateKeyHex: 'owner-priv-hex' })
    apiRecoverWorkspaceKeyHex.mockResolvedValue('workspace-key-hex')
    wrapNoteKeyForRecipient.mockResolvedValue('wrapped-for-member')
    apiProvisionWorkspaceKey.mockResolvedValue({ provisioned: true })
  })

  it('wraps the workspace key for the member device missing an envelope, not the one that has it', async () => {
    const cloud = useCloudWorkspaces()
    const count = await cloud.provisionKeysForMember('w1', 'm2')
    expect(count).toBe(1)
    expect(wrapNoteKeyForRecipient).toHaveBeenCalledTimes(1)
    const [pubkey, wsKey] = wrapNoteKeyForRecipient.mock.calls[0]
    expect(pubkey).toBe('member-pub-hex')
    expect(pubkey).not.toBe('owner-pub-hex')
    expect(wsKey).toBe('workspace-key-hex')
    expect(apiProvisionWorkspaceKey).toHaveBeenCalledWith(
      'w1',
      [{ userId: 'm2', deviceId: 'dev-a', wrappedKey: 'wrapped-for-member' }],
      expect.any(Object)
    )
  })

  it('autoProvisionPendingKeys fans out to every device reporting hasEnvelope:false', async () => {
    apiGetWorkspacePublicKeys.mockResolvedValue([
      { userId: 'owner-1', deviceId: 'dev-o', kemPublicKey: 'owner-pub', hasEnvelope: true },
      { userId: 'owner-1', deviceId: 'dev-o2', kemPublicKey: 'owner-pub-2', hasEnvelope: false },
      { userId: 'm2', deviceId: 'dev-a', kemPublicKey: 'member-pub', hasEnvelope: false },
    ])
    const cloud = useCloudWorkspaces()
    cloud.workspaces.value = [{ id: 'w1', role: 'owner' }]

    await cloud.autoProvisionPendingKeys()

    expect(wrapNoteKeyForRecipient).toHaveBeenCalledTimes(2)
    const recipients = apiProvisionWorkspaceKey.mock.calls[0][1]
    expect(recipients.map((r) => `${r.userId}:${r.deviceId}`).sort()).toEqual([
      'm2:dev-a',
      'owner-1:dev-o2',
    ])
  })

  it('autoProvisionPendingKeys marks terminal failure and does not retry infinitely', async () => {
    const cloud = useCloudWorkspaces()
    cloud.workspaces.value = [{ id: 'w1', role: 'owner' }]
    // first call: no envelope this device can unwrap
    apiRecoverWorkspaceKeyHex.mockResolvedValueOnce(null)

    await cloud.autoProvisionPendingKeys()
    expect(wrapNoteKeyForRecipient).not.toHaveBeenCalled()

    // second call should skip the workspace (terminal) and never re-fetch
    apiGetWorkspacePublicKeys.mockClear()
    apiRecoverWorkspaceKeyHex.mockClear()
    wrapNoteKeyForRecipient.mockClear()
    await cloud.autoProvisionPendingKeys()
    expect(apiGetWorkspacePublicKeys).not.toHaveBeenCalled()
    expect(wrapNoteKeyForRecipient).not.toHaveBeenCalled()
  })
})
