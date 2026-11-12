import { describe, expect, it, vi, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';

const apiGetWorkspaces = vi.fn();
const apiDeleteWorkspace = vi.fn();
const normalizeWorkspaceList = vi.fn((raw) => raw);

vi.mock('@/lib/api/workspaces', () => ({
  getWorkspaces: (...args) => apiGetWorkspaces(...args),
  createWorkspace: vi.fn(),
  deleteWorkspace: (...args) => apiDeleteWorkspace(...args),
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
  detachLocalWorkspace: vi.fn(),
}));

vi.mock('@/lib/native/workspaces', () => native);

import { useCloudWorkspaces } from '../useCloudWorkspaces.js';

describe('register + reconcile cloud workspaces', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    apiGetWorkspaces.mockResolvedValue([]);
    apiDeleteWorkspace.mockResolvedValue({});
    normalizeWorkspaceList.mockImplementation((raw) => raw);
    native.listLocalWorkspaces.mockResolvedValue([]);
    native.getActiveLocalWorkspace.mockResolvedValue({ id: 'default' });
    native.registerLocalWorkspace.mockResolvedValue({});
    native.switchLocalWorkspace.mockResolvedValue({});
    native.deleteLocalWorkspace.mockResolvedValue({});
    native.detachLocalWorkspace.mockResolvedValue({});
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

  it('never deletes local data when a shared workspace is missing from one successful list', async () => {
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
    await vi.waitFor(() => expect(native.detachLocalWorkspace).toHaveBeenCalledWith('shared-1'));

    expect(native.deleteLocalWorkspace).not.toHaveBeenCalled();
    expect(native.detachLocalWorkspace).not.toHaveBeenCalledWith('default');
    expect(native.detachLocalWorkspace).not.toHaveBeenCalledWith('personal-cloud');
  });

  it('converges: an already-detached workspace is never reprocessed or deleted', async () => {
    const local = [
      { id: 'default', workspaceType: 'personal', cloudSync: false },
      { id: 'shared-1', workspaceType: 'shared', cloudSync: true },
    ];
    apiGetWorkspaces.mockResolvedValue([]);
    native.listLocalWorkspaces.mockImplementation(async () => local.map((w) => ({ ...w })));
    native.detachLocalWorkspace.mockImplementation(async (id) => {
      const ws = local.find((w) => w.id === id);
      if (ws) ws.cloudSync = false;
    });

    const cloud = useCloudWorkspaces();
    await cloud.fetchWorkspaces();
    await vi.waitFor(() => expect(native.detachLocalWorkspace).toHaveBeenCalledTimes(1));

    await cloud.fetchWorkspaces();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(native.detachLocalWorkspace).toHaveBeenCalledTimes(1);
    expect(native.deleteLocalWorkspace).not.toHaveBeenCalled();
  });

  it('removes the local mirror on an intentional user-initiated deletion', async () => {
    native.listLocalWorkspaces.mockResolvedValue([
      { id: 'default', workspaceType: 'personal', cloudSync: false },
      { id: 'shared-1', workspaceType: 'shared', cloudSync: true },
    ]);
    native.getActiveLocalWorkspace.mockResolvedValue({ id: 'default' });

    const cloud = useCloudWorkspaces();
    await cloud.deleteWorkspace('shared-1');

    expect(apiDeleteWorkspace).toHaveBeenCalledWith('shared-1', expect.anything());
    expect(native.deleteLocalWorkspace).toHaveBeenCalledWith('shared-1');
  });

  it('switches away from the active workspace before an intentional delete', async () => {
    native.listLocalWorkspaces.mockResolvedValue([
      { id: 'default', workspaceType: 'personal', cloudSync: false },
      { id: 'shared-1', workspaceType: 'shared', cloudSync: true },
    ]);
    native.getActiveLocalWorkspace.mockResolvedValue({ id: 'shared-1' });

    const cloud = useCloudWorkspaces();
    await cloud.deleteWorkspace('shared-1');

    expect(native.switchLocalWorkspace).toHaveBeenCalledWith('default');
    expect(native.deleteLocalWorkspace).toHaveBeenCalledWith('shared-1');
  });

  it('does not hold loading while reconciliation detaches in the background', async () => {
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
    await vi.waitFor(() => expect(native.detachLocalWorkspace).toHaveBeenCalled());
  });
});
