import { describe, expect, it, vi, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';

const apiJoinWorkspace = vi.fn();
const apiGetWorkspaces = vi.fn();
const apiMyPending = vi.fn();

vi.mock('@/lib/api/workspaces', () => ({
  getWorkspaces: (...args) => apiGetWorkspaces(...args),
  createWorkspace: vi.fn(),
  deleteWorkspace: vi.fn(),
  addMember: vi.fn(),
  removeMember: vi.fn(),
  joinWorkspace: (...args) => apiJoinWorkspace(...args),
  listMyPendingWorkspaceRequests: (...args) => apiMyPending(...args),
}));

vi.mock('@/lib/api/types', () => ({
  normalizeWorkspaceList: (raw) => raw,
}));

vi.mock('@/store/account', () => ({
  useAccountStore: () => ({
    isAuthenticated: true,
    serverUrl: 'https://api.test',
    isPaidPlan: true,
  }),
}));

import { useCloudWorkspaces } from '../useCloudWorkspaces.js';

describe('useCloudWorkspaces pending join requests', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    apiGetWorkspaces.mockResolvedValue([]);
  });

  it('surfaces the pending state from joinWorkspace instead of swallowing it', async () => {
    apiJoinWorkspace.mockResolvedValue({ pending: true, workspaceId: 'w1', role: 'editor' });
    const cloud = useCloudWorkspaces();
    const result = await cloud.joinWorkspace('tok');
    expect(result.pending).toBe(true);
    expect(result.workspaceId).toBe('w1');
  });

  it('loads the caller own awaiting-approval rows', async () => {
    apiMyPending.mockResolvedValue([
      { id: 'r1', workspaceId: 'w1', role: 'editor', createdAt: 'now' },
    ]);
    const cloud = useCloudWorkspaces();
    await cloud.fetchMyPendingRequests();
    expect(apiMyPending).toHaveBeenCalledWith({ baseUrl: 'https://api.test' });
    expect(cloud.pendingRequests.value).toHaveLength(1);
    expect(cloud.pendingRequests.value[0].workspaceId).toBe('w1');
  });
});
