import { describe, expect, it, vi, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';

const apiGetWorkspaces = vi.fn();
const normalizeWorkspaceList = vi.fn((raw) => raw);

vi.mock('@/lib/api/workspaces', () => ({
  getWorkspaces: (...args) => apiGetWorkspaces(...args),
  createWorkspace: vi.fn(),
  deleteWorkspace: vi.fn(),
  addMember: vi.fn(),
  removeMember: vi.fn(),
  joinWorkspace: vi.fn(),
}));

vi.mock('@/lib/api/types', () => ({
  normalizeWorkspaceList: (...args) => normalizeWorkspaceList(...args),
}));

vi.mock('@/store/account', () => ({
  useAccountStore: () => ({
    isAuthenticated: true,
    serverUrl: 'https://api.test',
    isPaidPlan: true,
    activeAccount: { organizations: [{ id: 'org-personal' }] },
    activeOrgId: 'org-personal',
  }),
}));

const native = vi.hoisted(() => ({
  listLocalWorkspaces: vi.fn(),
  getActiveLocalWorkspace: vi.fn(),
  switchLocalWorkspace: vi.fn(),
  deleteLocalWorkspace: vi.fn(),
  registerLocalWorkspace: vi.fn(),
}));

vi.mock('@/lib/native/workspaces', () => native);

import { useCloudWorkspaces } from '../useCloudWorkspaces.js';

describe('register + reconcile cloud workspaces', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    apiGetWorkspaces.mockResolvedValue([]);
    normalizeWorkspaceList.mockImplementation((raw) => raw);
    native.listLocalWorkspaces.mockResolvedValue([]);
    native.getActiveLocalWorkspace.mockResolvedValue({ id: 'default' });
    native.registerLocalWorkspace.mockResolvedValue({});
    native.switchLocalWorkspace.mockResolvedValue({});
    native.deleteLocalWorkspace.mockResolvedValue({});
  });

  it('registers shared workspaces as shared and personal ones as personal', async () => {
    apiGetWorkspaces.mockResolvedValue([
      { id: 'w-team', name: 'Design', orgId: 'org-team', ownerId: 'u1' },
      { id: 'w-personal', name: 'Mine', orgId: 'org-personal', ownerId: 'u1' },
    ]);

    const cloud = useCloudWorkspaces();
    await cloud.fetchWorkspaces();

    expect(native.registerLocalWorkspace).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'w-team', workspaceType: 'shared', orgId: 'org-team' })
    );
    expect(native.registerLocalWorkspace).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'w-personal', workspaceType: 'personal', orgId: 'org-personal' })
    );
  });

  it('deletes a removed shared workspace and never a personal one', async () => {
    apiGetWorkspaces.mockResolvedValue([
      { id: 'personal-cloud', name: 'Mine', orgId: 'org-personal', ownerId: 'u1' },
    ]);
    native.listLocalWorkspaces.mockResolvedValue([
      { id: 'default', workspaceType: 'personal', cloudSync: false },
      { id: 'shared-1', workspaceType: 'shared', cloudSync: true },
      { id: 'personal-cloud', workspaceType: 'personal', cloudSync: true },
    ]);

    const cloud = useCloudWorkspaces();
    await cloud.fetchWorkspaces();
    await vi.waitFor(() => expect(native.deleteLocalWorkspace).toHaveBeenCalled());

    expect(native.deleteLocalWorkspace).toHaveBeenCalledWith('shared-1');
    expect(native.deleteLocalWorkspace).not.toHaveBeenCalledWith('default');
    expect(native.deleteLocalWorkspace).not.toHaveBeenCalledWith('personal-cloud');
  });

  it('switches away from an active removed shared workspace before deleting', async () => {
    apiGetWorkspaces.mockResolvedValue([]);
    native.listLocalWorkspaces.mockResolvedValue([
      { id: 'default', workspaceType: 'personal', cloudSync: false },
      { id: 'shared-1', workspaceType: 'shared', cloudSync: true },
    ]);
    native.getActiveLocalWorkspace.mockResolvedValue({ id: 'shared-1' });

    const cloud = useCloudWorkspaces();
    await cloud.fetchWorkspaces();
    await vi.waitFor(() => expect(native.deleteLocalWorkspace).toHaveBeenCalled());

    expect(native.switchLocalWorkspace).toHaveBeenCalledWith('default');
    expect(native.deleteLocalWorkspace).toHaveBeenCalledWith('shared-1');
  });

  it('does not hold loading while reconciliation deletes in the background', async () => {
    apiGetWorkspaces.mockResolvedValue([
      { id: 'personal-cloud', name: 'Mine', orgId: 'org-personal', ownerId: 'u1' },
    ]);
    native.listLocalWorkspaces.mockResolvedValue([
      { id: 'default', workspaceType: 'personal', cloudSync: false },
      { id: 'shared-1', workspaceType: 'shared', cloudSync: true },
    ]);

    const cloud = useCloudWorkspaces();
    await cloud.fetchWorkspaces();

    expect(cloud.loading.value).toBe(false);
    await vi.waitFor(() => expect(native.deleteLocalWorkspace).toHaveBeenCalled());
  });
});
