import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';

const apiGetWorkspaces = vi.fn();
const apiGetWorkspacePublicKeys = vi.fn();
const apiRecoverWorkspaceKeyHex = vi.fn();
const apiRecoverWorkspaceKeyFromRecord = vi.fn();
const apiProvisionWorkspaceKey = vi.fn();

vi.mock('@/lib/api/workspaces', () => ({
  getWorkspaces: (...args) => apiGetWorkspaces(...args),
  createWorkspace: vi.fn(),
  renameWorkspace: vi.fn(),
  updateWorkspaceDecoration: vi.fn(),
  deleteWorkspace: vi.fn(),
  addMember: vi.fn(),
  removeMember: vi.fn(),
  joinWorkspace: vi.fn(),
  listMyPendingWorkspaceRequests: vi.fn(),
  getWorkspacePublicKeys: (...args) => apiGetWorkspacePublicKeys(...args),
  recoverWorkspaceKeyHex: (...args) => apiRecoverWorkspaceKeyHex(...args),
  recoverWorkspaceKeyFromRecord: (...args) => apiRecoverWorkspaceKeyFromRecord(...args),
  provisionWorkspaceKey: (...args) => apiProvisionWorkspaceKey(...args),
  getCachedWorkspaceKey: vi.fn(),
}));

vi.mock('@/lib/api/types', () => ({
  normalizeWorkspaceList: (raw) => raw,
}));

vi.mock('@/store/account', () => ({
  useAccountStore: () => ({
    isAuthenticated: true,
    serverUrl: 'https://api.test',
    isPaidPlan: true,
    profile: { id: 'me' },
  }),
}));

vi.mock('@/utils/crypto/identity', () => ({
  loadOrCreateIdentity: vi.fn(async () => ({ privateKeyHex: 'priv' })),
}));

vi.mock('@/utils/crypto/note-key', () => ({
  wrapNoteKeyForRecipient: vi.fn(async () => 'wrapped-key'),
}));

import { useCloudWorkspaces } from '../useCloudWorkspaces.js';

const OWNER_WORKSPACE = { id: 'w1', name: 'W', role: 'owner' };

describe('useCloudWorkspaces provisioning issue', () => {
  beforeEach(async () => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    localStorage.clear();
    apiGetWorkspaces.mockResolvedValue([]);
    apiGetWorkspacePublicKeys.mockResolvedValue([]);
    apiRecoverWorkspaceKeyHex.mockResolvedValue(null);
    apiProvisionWorkspaceKey.mockResolvedValue({});

    const cloud = useCloudWorkspaces();
    cloud.workspaces.value = [];
    await cloud.retryProvisioning();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('reports no issue when no device is missing an envelope', async () => {
    const cloud = useCloudWorkspaces();
    cloud.workspaces.value = [OWNER_WORKSPACE];
    apiGetWorkspacePublicKeys.mockResolvedValue([
      { userId: 'me', deviceId: 'd1', kemPublicKey: 'k1', hasEnvelope: true },
    ]);

    await cloud.autoProvisionPendingKeys();

    expect(cloud.provisioningIssue.value).toBeNull();
  });

  it('surfaces a not-synced issue when this device has no usable workspace key', async () => {
    const cloud = useCloudWorkspaces();
    cloud.workspaces.value = [OWNER_WORKSPACE];
    apiGetWorkspacePublicKeys.mockResolvedValue([
      { userId: 'me', deviceId: 'd1', kemPublicKey: 'k1', hasEnvelope: false },
    ]);
    apiRecoverWorkspaceKeyHex.mockResolvedValue(null);

    await cloud.autoProvisionPendingKeys();

    expect(cloud.provisioningIssue.value).toBe('not-synced');
  });

  it('flags a refused device-key change distinctly and shares nothing', async () => {
    const cloud = useCloudWorkspaces();
    cloud.workspaces.value = [OWNER_WORKSPACE];
    localStorage.setItem('kem-pin:me:d1', 'old-key');
    apiGetWorkspacePublicKeys.mockResolvedValue([
      { userId: 'me', deviceId: 'd1', kemPublicKey: 'new-key', hasEnvelope: false },
    ]);
    apiRecoverWorkspaceKeyHex.mockResolvedValue('workspace-key-hex');

    await cloud.autoProvisionPendingKeys();

    expect(cloud.provisioningIssue.value).toBe('key-changed');
    expect(apiProvisionWorkspaceKey).not.toHaveBeenCalled();
  });

  it('reports no issue when this device provisions successfully', async () => {
    const cloud = useCloudWorkspaces();
    cloud.workspaces.value = [OWNER_WORKSPACE];
    apiGetWorkspacePublicKeys.mockResolvedValue([
      { userId: 'me', deviceId: 'd1', kemPublicKey: 'k1', hasEnvelope: false },
    ]);
    apiRecoverWorkspaceKeyHex.mockResolvedValue('workspace-key-hex');

    await cloud.autoProvisionPendingKeys();
    expect(apiProvisionWorkspaceKey).toHaveBeenCalledTimes(1);
    expect(cloud.provisioningIssue.value).toBeNull();
  });

  it('silently caches a recoverable workspace key on load, no password involved', async () => {
    const cloud = useCloudWorkspaces();
    apiGetWorkspaces.mockResolvedValue([
      {
        id: 'w2',
        name: 'W',
        role: 'editor',
        wrappedKeys: [{ deviceId: 'd1', wrappedKey: 'env' }],
      },
    ]);
    apiRecoverWorkspaceKeyFromRecord.mockResolvedValue('workspace-key-hex');

    await cloud.fetchWorkspaces();

    expect(apiRecoverWorkspaceKeyFromRecord).toHaveBeenCalledTimes(1);
    const [record, identity] = apiRecoverWorkspaceKeyFromRecord.mock.calls[0];
    expect(record.id).toBe('w2');
    expect(identity).toEqual({ privateKeyHex: 'priv' });
  });
});
