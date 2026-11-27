import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

// Adding an account moves the app to the arriving account's workspace. Notes
// made before the account existed live in a local-only workspace the switcher
// never lists, so they must be copied across or they vanish from the user's
// side. This pins that copy: done for a local workspace, never twice.
const {
  blobs,
  noteData,
  localWorkspace,
  docNoteIds,
  getSnapshotsSpy,
  appendBatchSpy,
  seedSpy,
  localNotesCopiedSpy,
  markCopiedSpy,
  archiveSpy,
  confirmSpy,
} = vi.hoisted(() => ({
  blobs: new Map(),
  noteData: {},
  localWorkspace: { value: null },
  docNoteIds: { value: [] },
  getSnapshotsSpy: vi.fn(async () => ({})),
  appendBatchSpy: vi.fn(async () => 0),
  seedSpy: vi.fn(async () => ({ seededNotes: 0 })),
  localNotesCopiedSpy: vi.fn(async () => false),
  markCopiedSpy: vi.fn(async () => {}),
  archiveSpy: vi.fn(async () => {}),
  confirmSpy: vi.fn(),
}));

vi.mock('@/lib/native/security', () => ({
  isEncryptionAvailable: vi.fn(async () => true),
  encryptString: vi.fn(async (s) => `cipher:${s}`),
  decryptString: vi.fn(async (s) => s.replace(/^cipher:/, '')),
  storeSecureBlob: vi.fn(async (key, value) => {
    blobs.set(key, value);
  }),
  fetchSecureBlob: vi.fn(async (key) => blobs.get(key) ?? null),
  clearSecureBlob: vi.fn(async (key) => {
    blobs.delete(key);
  }),
}));

vi.mock('@/lib/api/auth', () => ({
  logout: vi.fn(async () => ({})),
  passwordLogin: vi.fn(async () => ({
    token: 'tok',
    user: { id: 'n1', email: 'new@test.test' },
    subscription: { plan: 'pro' },
  })),
}));
vi.mock('@/lib/api/account', () => ({
  getAccount: vi.fn(async () => ({
    profile: { id: 'n1', email: 'new@test.test', kemPublicKey: 'pk' },
    subscription: { plan: 'pro' },
    organizations: [{ id: 'o1', workspaces: [{ id: 'w-new', name: 'New Team' }] }],
    devices: [],
  })),
}));
vi.mock('@/utils/sync/sync-repository.js', () => ({ getSyncDeviceId: vi.fn(async () => 'dev-1') }));
vi.mock('@/composable/useNoteYjs.js', () => ({ flushAllNoteYjsPending: vi.fn(async () => {}) }));
vi.mock('@/lib/sync/ws-sync.js', () => ({
  getWsSync: () => ({ stop: vi.fn(), start: vi.fn() }),
}));
vi.mock('@/lib/yjs/workspace-doc.js', () => ({ flushPendingMetaUpdates: vi.fn(async () => {}) }));
vi.mock('@/lib/yjs/meta-doc.js', () => ({
  destroyWorkspaceDoc: vi.fn(),
  getWorkspaceDoc: () => ({
    getMap: () => new Map(docNoteIds.value.map((id) => [id, {}])),
  }),
}));
vi.mock('@/store/note', () => ({
  useNoteStore: () => ({ data: noteData, syncInProgress: false }),
  clearNoteContentSignatures: vi.fn(),
}));
vi.mock('@/store/comment', () => ({ useCommentStore: () => ({ reset: vi.fn() }) }));
vi.mock('@/store/collaborator', () => ({ useCollaboratorStore: () => ({ reset: vi.fn() }) }));
vi.mock('@/store/workspace', () => ({
  useWorkspaceStore: () => ({
    activeId: null,
    reset: vi.fn(),
    retrieve: vi.fn(async () => {}),
  }),
}));
vi.mock('@/store/folder', () => ({ useFolderStore: () => ({ data: {} }) }));
vi.mock('@/store/label', () => ({ useLabelStore: () => ({ data: [], colors: {} }) }));
vi.mock('@/utils/note/search.js', () => ({ clearSearchIndex: vi.fn() }));
vi.mock('@/utils/sync/rust-shim.js', () => ({
  stopRustSync: vi.fn(async () => {}),
  startRustSync: vi.fn(async () => {}),
  kickRustSync: vi.fn(),
  isRustSyncActive: () => false,
}));

vi.mock('@/composable/useCloudWorkspaces', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    useCloudWorkspaces: () => ({
      ...actual.useCloudWorkspaces(),
      teardownLiveWorkspaceState: vi.fn(async () => {}),
      fetchWorkspaces: vi.fn(async () => {}),
    }),
  };
});
vi.mock('@/lib/native/workspaces', () => ({
  // The pool swap makes the account workspace the active one.
  switchLocalWorkspace: vi.fn(async (id) => {
    localWorkspace.value = { id, cloudSync: true };
  }),
  listLocalWorkspaces: vi.fn(async () => []),
  getActiveLocalWorkspace: vi.fn(async () => localWorkspace.value),
  localNotesCopied: localNotesCopiedSpy,
  markLocalNotesCopied: markCopiedSpy,
  archiveLocalWorkspace: archiveSpy,
}));
vi.mock('@/lib/dialog', () => ({
  useDialog: () => ({ confirm: confirmSpy, alert: vi.fn() }),
}));
vi.mock('@/composable/useAppShell', () => ({ runWorkspaceInit: vi.fn(async () => {}) }));
vi.mock('@/utils/crypto/identity', () => ({
  loadOrCreateIdentity: vi.fn(async () => ({ publicKeyHex: 'pk', privateKeyHex: 'sk' })),
  publishIdentity: vi.fn(async () => ({ ok: true })),
}));
vi.mock('@/utils/sync/shared-keys', () => ({ clearSharedSyncKeys: vi.fn(async () => {}) }));
vi.mock('@/lib/native/yjs', () => ({
  getSnapshots: getSnapshotsSpy,
  appendBatch: appendBatchSpy,
}));
vi.mock('@/lib/yjs/helpers', () => ({ getDeviceId: () => 'dev-1' }));
vi.mock('@/lib/yjs/meta-store', () => ({
  seedWorkspaceDocFromData: seedSpy,
  writeStoresFromWorkspace: vi.fn(async () => {}),
}));

import { useAccountAuth } from '@/composable/useAccountAuth';
import { clearIndex } from '@/lib/accounts-index';

describe('adding an account to an install with local notes', () => {
  let signIn = null;

  beforeEach(async () => {
    setActivePinia(createPinia());
    localStorage.clear();
    blobs.clear();
    vi.clearAllMocks();
    for (const key of Object.keys(noteData)) delete noteData[key];
    localWorkspace.value = { id: 'default', cloudSync: false };
    docNoteIds.value = [];
    getSnapshotsSpy.mockResolvedValue({ n1: 'AAAA' });
    localNotesCopiedSpy.mockResolvedValue(false);
    markCopiedSpy.mockResolvedValue(undefined);
    archiveSpy.mockResolvedValue(undefined);
    confirmSpy.mockReset();
    await clearIndex();
    signIn = useAccountAuth().signInWithPassword;
  });

  it('copies the local workspace notes into the arriving workspace', async () => {
    noteData.n1 = { id: 'n1', title: 'Before the account' };

    await signIn('new@test.test', 'password');

    expect(appendBatchSpy).toHaveBeenCalledWith(['n1'], ['AAAA'], ['dev-1']);
    expect(seedSpy).toHaveBeenCalledTimes(1);
    expect(Object.keys(seedSpy.mock.calls[0][0])).toEqual(['n1']);
    // One-shot: the local workspace is marked and the user is offered a delete
    // that keeps the files restorable.
    expect(markCopiedSpy).toHaveBeenCalledWith('default');
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    await confirmSpy.mock.calls[0][0].onConfirm();
    expect(archiveSpy).toHaveBeenCalledWith('default');
  });

  it('copies a local workspace once, never into a second account workspace', async () => {
    noteData.n1 = { id: 'n1', title: 'Already copied' };
    localNotesCopiedSpy.mockResolvedValue(true);

    await signIn('other@test.test', 'password');

    expect(appendBatchSpy).not.toHaveBeenCalled();
    expect(seedSpy).not.toHaveBeenCalled();
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it('does not copy when the leaving workspace belongs to the cloud', async () => {
    localWorkspace.value = { id: 'w-personal', cloudSync: true };
    noteData.n1 = { id: 'n1', title: 'Already synced' };

    await signIn('new@test.test', 'password');

    expect(appendBatchSpy).not.toHaveBeenCalled();
    expect(seedSpy).not.toHaveBeenCalled();
  });

  it('skips ids the arriving workspace already holds, so a re-sign-in cannot duplicate', async () => {
    noteData.n1 = { id: 'n1', title: 'Already copied' };
    docNoteIds.value = ['n1'];

    await signIn('new@test.test', 'password');

    expect(appendBatchSpy).not.toHaveBeenCalled();
    expect(seedSpy).not.toHaveBeenCalled();
  });
});
