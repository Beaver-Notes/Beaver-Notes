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
