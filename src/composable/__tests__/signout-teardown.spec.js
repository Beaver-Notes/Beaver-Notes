import { describe, test, expect, vi, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';

vi.mock('@/lib/api/auth', () => ({
  default: { logout: vi.fn(async () => ({ ok: true })) },
}));

vi.mock('@/lib/native/security', () => ({
  default: {
    isAvailable: async () => true,
    setSecure: async () => true,
    getSecure: async () => null,
    deleteSecure: async () => true,
    setDevicePassword: async () => true,
  },
}));

import { useAccountAuth } from '@/composable/useAccountAuth';
import { useAccountStore } from '@/store/account';
import { useCommentStore } from '@/store/comment';
import { useCollaboratorStore } from '@/store/collaborator';
import { useWorkspaceStore } from '@/store/workspace';
import {
  getCachedWorkspaceKey,
  setCachedWorkspaceKey,
} from '@/lib/api/workspaces';

const KEY_HEX = 'ff'.repeat(32);

async function signOutWithLiveState() {
  const auth = useAccountAuth();
  const account = useAccountStore();
  account.status = 'authenticated';
  account.token = 'live-token';

  setCachedWorkspaceKey('ws-1', KEY_HEX);
  useCommentStore().comments = [
    { id: 'c1', content: 'Q3 board deck: firing the acquirer on Friday' },
  ];
  useCollaboratorStore().collaborators = [
    { userId: 'u2', email: 'merger-target@enron.com' },
  ];
  useWorkspaceStore().workspaces = [{ id: 'ws-1', name: 'Project Falcon' }];

  await auth.signOut();
}

describe('sign-out destroys every secret the previous account owned', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  test('CONTROL: the state really is populated before teardown', () => {
    const account = useAccountStore();
    account.status = 'authenticated';
    account.token = 'live-token';
    setCachedWorkspaceKey('ws-1', KEY_HEX);
    useCommentStore().comments = [{ id: 'c1', content: 'secret text' }];
    useCollaboratorStore().collaborators = [{ userId: 'u2', email: 'a@b.c' }];
    useWorkspaceStore().workspaces = [{ id: 'ws-1', name: 'Project Falcon' }];

    expect(getCachedWorkspaceKey('ws-1')).toBe(KEY_HEX);
    expect(useCommentStore().comments).toHaveLength(1);
    expect(useCollaboratorStore().collaborators).toHaveLength(1);
    expect(useWorkspaceStore().workspaces).toHaveLength(1);
  });

  test('DESIRED: the cached workspace key is gone', async () => {
    await signOutWithLiveState();
    expect(getCachedWorkspaceKey('ws-1')).toBeNull();
  });

  test('DESIRED: decrypted comment text is gone', async () => {
    await signOutWithLiveState();
    expect(useCommentStore().comments).toEqual([]);
  });

  test('DESIRED: collaborator emails are gone', async () => {
    await signOutWithLiveState();
    expect(useCollaboratorStore().collaborators).toEqual([]);
  });

  test('DESIRED: decrypted workspace names are gone', async () => {
    await signOutWithLiveState();
    expect(useWorkspaceStore().workspaces).toEqual([]);
  });
});
