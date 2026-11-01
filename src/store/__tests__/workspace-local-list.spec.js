import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

const native = vi.hoisted(() => ({ list: [], active: null }));
const cloud = vi.hoisted(() => ({ workspaces: [], activeId: null }));

vi.mock('@/composable/useCloudWorkspaces', () => ({
  useCloudWorkspaces: () => ({
    workspaces: { value: cloud.workspaces },
    activeId: { value: cloud.activeId },
    fetchWorkspaces: vi.fn(async () => {}),
  }),
}));

vi.mock('@/lib/native/workspaces', () => ({
  listLocalWorkspaces: vi.fn(async () => native.list),
  getActiveLocalWorkspace: vi.fn(async () => native.active),
}));

vi.mock('@/store/account', () => ({
  useAccountStore: () => ({ status: 'authenticated', token: 'test-token' }),
}));

const { useWorkspaceStore } = await import('@/store/workspace');

describe('workspace store local workspaces', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    native.list = [];
    native.active = null;
    cloud.workspaces = [];
    cloud.activeId = null;
  });

  it('lists a local-only workspace next to the cloud ones', async () => {
    cloud.workspaces = [{ id: 'w-cloud', name: 'Team' }];
    cloud.activeId = 'w-cloud';
    native.list = [
      { id: 'default', name: 'Default', cloudSync: false },
      { id: 'w-cloud', name: 'Team', cloudSync: true },
    ];

    const store = useWorkspaceStore();
    await store.retrieve();

    expect(store.workspaces).toEqual([
      { id: 'w-cloud', name: 'Team', role: undefined, ownerId: undefined, storageUsedBytes: undefined, createdAt: undefined, emoji: undefined, color: undefined },
      { id: 'default', name: 'Default', local: true },
    ]);
  });

  it('takes the active id from the device registry, not the cloud list', async () => {
    cloud.workspaces = [{ id: 'w-cloud', name: 'Team' }];
    cloud.activeId = 'w-cloud';
    native.active = { id: 'default', cloudSync: false };

    const store = useWorkspaceStore();
    await store.retrieve();

    expect(store.activeId).toBe('default');
  });
});
