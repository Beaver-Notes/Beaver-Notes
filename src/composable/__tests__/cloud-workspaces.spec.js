import { describe, expect, it, vi, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';

const { ctl } = vi.hoisted(() => ({ ctl: { isPaid: true } }));

const apiGetWorkspaces = vi.fn();
const apiRenameWorkspace = vi.fn();
const apiUpdateWorkspaceDecoration = vi.fn();
const apiRecoverWorkspaceKeyHex = vi.fn();
const normalizeWorkspaceList = vi.fn((raw) => raw);

vi.mock('@/lib/api/workspaces', () => ({
  getWorkspaces: (...args) => apiGetWorkspaces(...args),
  createWorkspace: vi.fn(),
  deleteWorkspace: vi.fn(),
  addMember: vi.fn(),
  removeMember: vi.fn(),
  joinWorkspace: vi.fn(),
  renameWorkspace: (...args) => apiRenameWorkspace(...args),
  updateWorkspaceDecoration: (...args) =>
    apiUpdateWorkspaceDecoration(...args),
  recoverWorkspaceKeyHex: (...args) => apiRecoverWorkspaceKeyHex(...args),
  getCachedWorkspaceKey: () => null,
}));

vi.mock('@/utils/crypto/collab', () => ({
  importCollabKey: vi.fn(async () => ({})),
}));

vi.mock('@/utils/crypto/comment-crypto', () => ({
  encryptName: vi.fn(async () => 'enc-name'),
}));

vi.mock('@/utils/crypto/identity', () => ({
  loadOrCreateIdentity: vi.fn(async () => ({ privateKeyHex: '00' })),
}));

vi.mock('@/lib/api/types', () => ({
  normalizeWorkspaceList: (...args) => normalizeWorkspaceList(...args),
}));

vi.mock('@/store/account', () => ({
  useAccountStore: () => ({
    isAuthenticated: true,
    serverUrl: 'https://api.test',
    get isPaidPlan() {
      return ctl.isPaid;
    },
  }),
}));

import { useCloudWorkspaces } from '../useCloudWorkspaces.js';

describe('useCloudWorkspaces.fetchWorkspaces dedup', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  it('makes a single request for concurrent calls', async () => {
    let resolveFn;
    apiGetWorkspaces.mockImplementation(
      () => new Promise((resolve) => (resolveFn = resolve))
    );
    normalizeWorkspaceList.mockImplementation((raw) => raw);

    const cloud = useCloudWorkspaces();
    const p1 = cloud.fetchWorkspaces();
    const p2 = cloud.fetchWorkspaces();

    resolveFn([{ id: 'w1', name: 'One' }]);
    await Promise.all([p1, p2]);

    expect(apiGetWorkspaces).toHaveBeenCalledTimes(1);
    expect(cloud.workspaces.value).toHaveLength(1);
  });

  it('fetches again once the previous request settled', async () => {
    apiGetWorkspaces.mockResolvedValue([]);
    normalizeWorkspaceList.mockImplementation((raw) => raw);

    const cloud = useCloudWorkspaces();
    await cloud.fetchWorkspaces();
    await cloud.fetchWorkspaces();

    expect(apiGetWorkspaces).toHaveBeenCalledTimes(2);
  });
});

describe('useCloudWorkspaces edit permissions', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    ctl.isPaid = true;
    apiRecoverWorkspaceKeyHex.mockResolvedValue('aa'.repeat(32));
  });

  function seedCloud(role) {
    const cloud = useCloudWorkspaces();
    cloud.workspaces.value = [{ id: 'w1', name: 'One', role }];
    return cloud;
  }

  it('lets an owner rename on the free plan', async () => {
    ctl.isPaid = false;
    const cloud = seedCloud('owner');

    await cloud.renameWorkspace('w1', 'Two');

    expect(apiRenameWorkspace).toHaveBeenCalledWith(
      'w1',
      'enc-name',
      expect.objectContaining({ baseUrl: 'https://api.test' }),
    );
    expect(cloud.workspaces.value[0].name).toBe('Two');
  });

  it('lets an admin change decoration on the free plan', async () => {
    ctl.isPaid = false;
    const cloud = seedCloud('admin');

    await cloud.updateWorkspaceDecoration('w1', { emoji: '📁' });

    expect(apiUpdateWorkspaceDecoration).toHaveBeenCalledWith(
      'w1',
      expect.objectContaining({ emoji: '📁' }),
    );
    expect(cloud.workspaces.value[0].emoji).toBe('📁');
  });

  it('refuses decoration for editors even on a paid plan', async () => {
    const cloud = seedCloud('editor');

    await expect(
      cloud.updateWorkspaceDecoration('w1', { emoji: '📁' }),
    ).rejects.toThrow('Only owners or admins');
    expect(apiUpdateWorkspaceDecoration).not.toHaveBeenCalled();
  });

  it('reports unknown workspaces before checking permissions', async () => {
    ctl.isPaid = false;
    const cloud = seedCloud('owner');

    await expect(cloud.renameWorkspace('nope', 'Two')).rejects.toThrow(
      'Workspace not found',
    );
  });
});
