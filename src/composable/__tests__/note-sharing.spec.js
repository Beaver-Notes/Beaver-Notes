import { describe, it, expect, vi, beforeEach } from 'vitest';

// Full API-layer mock: proves ensureNoteKey makes zero collaboration calls on
// personal notes. The legacy request-queue exports are deliberately absent:
// they must no longer exist as exports at all.
const api = vi.hoisted(() => ({
  inviteCollaborator: vi.fn(),
  generateInviteLink: vi.fn(),
  listCollaborators: vi.fn().mockResolvedValue([]),
  getWorkspaceMembers: vi.fn().mockResolvedValue({ members: [] }),
}));

const wsState = vi.hoisted(() => ({ activeId: null, retrieve: vi.fn() }));

// Residual 2: sharing must resolve the active workspace before inviting, and a
// server `note_ownership_required` refusal must surface actionable copy rather
// than the raw server string.
vi.mock('@/lib/api/workspaces', () => ({
  getWorkspaceMembers: api.getWorkspaceMembers,
}));

vi.mock('@/utils/sync/shared-notes', () => ({
  resolveNoteWorkspaceId: vi.fn((noteId, fallback) => fallback ?? null),
  isSharedNote: vi.fn(() => false),
}));

vi.mock('@/lib/api/collaboration', () => ({
  createCollaborationKey: vi.fn().mockResolvedValue({}),
  getCollaborationKey: vi.fn().mockResolvedValue({ wrappedKeys: [], noteHasKey: false }),
  listCollaboratorPublicKeys: vi.fn().mockResolvedValue({ collaborators: [] }),
  storeRecipients: vi.fn().mockResolvedValue({ existing: false }),
  rotateNoteKey: vi.fn().mockResolvedValue({ stored: 1, generation: 1 }),
  inviteCollaborator: api.inviteCollaborator,
  listCollaborators: api.listCollaborators,
  removeCollaborator: vi.fn().mockResolvedValue({}),
  generateInviteLink: api.generateInviteLink,
  listInviteLinks: vi.fn().mockResolvedValue([]),
  revokeInviteLink: vi.fn().mockResolvedValue({}),
  joinViaInviteLink: vi.fn().mockResolvedValue({}),
}));

// Orchestration-only spec: crypto internals are covered by note-key-fanout.spec.js.
vi.mock('@/utils/crypto/note-key', () => ({
  provisionNoteKey: vi.fn(),
  recoverNoteKeyFromEnvelopes: vi.fn(),
  clearUnwrappedKeyCache: vi.fn(),
  wrapNoteKeyForRecipient: vi.fn().mockResolvedValue('wrapped'),
  getCachedNoteKey: vi.fn(() => null),
  getPreviousNoteKeys: vi.fn(() => []),
  generateNoteKeyHex: vi.fn(async () => 'cd'.repeat(32)),
  buildNoteKeyPayload: vi.fn((cur, prev) => JSON.stringify({ v: 1, cur, prev })),
  rememberNoteKeyring: vi.fn(),
}));

vi.mock('@/utils/sync/shared-keys', () => ({
  registerSharedSyncKey: vi.fn().mockResolvedValue(true),
  expectSharedSyncNote: vi.fn().mockResolvedValue(true),
  clearSharedSyncKeys: vi.fn(),
  getActiveWsKey: vi.fn(() => null),
  setActiveWsKey: vi.fn(),
  registerWsKeyForNote: vi.fn(async () => true),
  registerWsKeyForNotes: vi.fn(async () => {}),
}));

vi.mock('@/utils/crypto/identity', () => ({
  loadOrCreateIdentity: vi.fn(async () => ({
    publicKeyHex: 'aa'.repeat(32),
    privateKeyHex: 'bb'.repeat(32),
  })),
}));

vi.mock('@/store/account', () => {
  const store = { isAuthenticated: true, serverUrl: 'https://sync.test', profile: null };
  return { useAccountStore: () => store, accountStore: store };
});

vi.mock('@/store/collaborator', () => ({
  useCollaboratorStore: () => ({ setCollaborators: vi.fn(), usernames: [] }),
}));

vi.mock('@/lib/account-storage', () => ({
  loadAccountDeviceId: vi.fn(() => 'dev-a'),
  saveAccountDeviceId: vi.fn(),
}));

vi.mock('@/store/workspace', () => ({
  useWorkspaceStore: () => ({
    get activeId() { return wsState.activeId; },
    retrieve: wsState.retrieve,
  }),
}));

import { useNoteSharing, NOTE_WORKSPACE_UNCONFIRMED_MESSAGE } from '@/composable/useNoteSharing';
import {
  createCollaborationKey,
  getCollaborationKey,
  listCollaboratorPublicKeys,
  storeRecipients,
} from '@/lib/api/collaboration';
import { provisionNoteKey, recoverNoteKeyFromEnvelopes } from '@/utils/crypto/note-key';
import { accountStore } from '@/store/account';

const NOTE_KEY = 'ab'.repeat(32);

describe('personal notes keep ML-KEM fan-out inert', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    accountStore.profile = null;
    localStorage.setItem('collaborationEnabled', 'false');
  });

  it('returns null immediately without any collaboration API traffic when the setting is unset', async () => {
    const result = await useNoteSharing().ensureNoteKey('note-1');

    expect(result).toBeNull();
    expect(createCollaborationKey).not.toHaveBeenCalled();
    expect(getCollaborationKey).not.toHaveBeenCalled();
    expect(storeRecipients).not.toHaveBeenCalled();
    expect(provisionNoteKey).not.toHaveBeenCalled();
  });

  it('still provisions when collaborationEnabled is explicitly turned on', async () => {
    localStorage.setItem('collaborationEnabled', 'true');
    provisionNoteKey.mockResolvedValue(NOTE_KEY);

    const result = await useNoteSharing().ensureNoteKey('note-1');

    expect(result).toBe(NOTE_KEY);
    expect(provisionNoteKey).toHaveBeenCalledTimes(1);
  });

  it('hands the resolved key to the durable sync engine for a cross-account note', async () => {
    localStorage.setItem('collaborationEnabled', 'true');
    provisionNoteKey.mockResolvedValue(NOTE_KEY);
    accountStore.profile = { id: 'self' };
    listCollaboratorPublicKeys.mockResolvedValue({
      collaborators: [{ userId: 'acct-other', deviceId: 'd1', kemPublicKey: 'aa', hasEnvelope: true }],
    });

    await useNoteSharing().ensureNoteKey('note-shared');

    const { registerSharedSyncKey } = await import('@/utils/sync/shared-keys');
    expect(registerSharedSyncKey).toHaveBeenCalledWith('note-shared', NOTE_KEY, [], {
      takeover: true,
    });
    listCollaboratorPublicKeys.mockResolvedValue({ collaborators: [] });
  });

  it('keeps a personal note on the items key (no shared-key registration)', async () => {
    localStorage.setItem('collaborationEnabled', 'true');
    provisionNoteKey.mockResolvedValue(NOTE_KEY);
    accountStore.profile = { id: 'self' };
    listCollaboratorPublicKeys.mockResolvedValue({
      collaborators: [{ userId: 'self', deviceId: 'd1', kemPublicKey: 'aa', hasEnvelope: true }],
    });

    await useNoteSharing().ensureNoteKey('note-personal');

    const { registerSharedSyncKey } = await import('@/utils/sync/shared-keys');
    expect(registerSharedSyncKey).not.toHaveBeenCalled();
    listCollaboratorPublicKeys.mockResolvedValue({ collaborators: [] });
  });

  it('leaves no request-queue path for a late joiner to file a request through', async () => {
    localStorage.setItem('collaborationEnabled', 'true');
    provisionNoteKey.mockResolvedValue(null);

    const actualApi = await vi.importActual('@/lib/api/collaboration');
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});

    const result = await useNoteSharing().ensureNoteKey('note-1');

    expect(result).toBeNull();
    expect(
      Object.keys(actualApi).some((k) => /distribut/i.test(k))
    ).toBe(false);
    expect(info).toHaveBeenCalledWith(
      '[notes] awaiting note-key re-wrap from a key-holding collaborator'
    );
    info.mockRestore();
  });

  it('registers the minted shared key even when the collaborator lookup rejects (L5)', async () => {
    localStorage.setItem('collaborationEnabled', 'true');
    provisionNoteKey.mockResolvedValue(NOTE_KEY);
    listCollaboratorPublicKeys.mockRejectedValue(new Error('network down'));

    vi.useFakeTimers();
    try {
      const result = await useNoteSharing().ensureNoteKey('note-transient');

      const { registerSharedSyncKey, expectSharedSyncNote } = await import(
        '@/utils/sync/shared-keys'
      );
      expect(result).toBe(NOTE_KEY);
      expect(expectSharedSyncNote).toHaveBeenCalledWith('note-transient', true);
      expect(registerSharedSyncKey).toHaveBeenCalledWith('note-transient', NOTE_KEY, [], {
        takeover: true,
      });
    } finally {
      listCollaboratorPublicKeys.mockResolvedValue({ collaborators: [] });
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it('retries on demand for a second device whose envelope is not there yet', async () => {
    localStorage.setItem('collaborationEnabled', 'true');
    provisionNoteKey.mockResolvedValue(null);
    getCollaborationKey.mockResolvedValue({
      wrappedKeys: [{ deviceId: 'd2', wrappedKey: 'wk' }],
      noteHasKey: true,
    });
    recoverNoteKeyFromEnvelopes
      .mockResolvedValueOnce(undefined)
      .mockResolvedValue(NOTE_KEY);

    vi.useFakeTimers();
    try {
      const promise = useNoteSharing().ensureNoteKey('note-second-device');
      await vi.advanceTimersByTimeAsync(2000);
      const result = await promise;

      expect(result).toBe(NOTE_KEY);
      expect(recoverNoteKeyFromEnvelopes.mock.calls.length).toBeGreaterThanOrEqual(2);
      const actualApi = await vi.importActual('@/lib/api/collaboration');
      expect(Object.keys(actualApi).some((k) => /distribut/i.test(k))).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('removing a collaborator rotates the note key (L8)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    accountStore.profile = { id: 'self' };
    localStorage.setItem('collaborationEnabled', 'true');
  });

  it('mints a new key, publishes it for the remaining members, and archives the old one', async () => {
    const OLD = 'ab'.repeat(32);
    const NEW = 'cd'.repeat(32);
    const api = await import('@/lib/api/collaboration');
    const {
      getCachedNoteKey,
      generateNoteKeyHex,
      buildNoteKeyPayload,
      rememberNoteKeyring,
    } = await import('@/utils/crypto/note-key');
    const { registerSharedSyncKey } = await import('@/utils/sync/shared-keys');

    getCachedNoteKey.mockReturnValue(OLD);
    generateNoteKeyHex.mockResolvedValue(NEW);
    buildNoteKeyPayload.mockReturnValue(JSON.stringify({ v: 1, cur: NEW, prev: [OLD] }));
    api.listCollaboratorPublicKeys.mockResolvedValue({
      collaborators: [
        { userId: 'self', deviceId: 'd1', kemPublicKey: 'pk-self', hasEnvelope: true },
        { userId: 'other', deviceId: 'd2', kemPublicKey: 'pk-other', hasEnvelope: true },
      ],
    });

    const sharing = useNoteSharing();
    sharing.collaborators.value = [
      { userId: 'self' },
      { userId: 'removed' },
      { userId: 'other' },
    ];

    await sharing.remove('note-l8', 'removed');

    expect(api.removeCollaborator).toHaveBeenCalledWith(
      'note-l8',
      'removed',
      expect.objectContaining({ baseUrl: 'https://sync.test' })
    );
    // Rotation ran exactly once, after the removal.
    expect(api.rotateNoteKey).toHaveBeenCalledTimes(1);
    const [noteId, recipients] = api.rotateNoteKey.mock.calls[0];
    expect(noteId).toBe('note-l8');
    // The removed user gets no envelope; remaining collaborators do.
    expect(recipients.some((r) => r.userId === 'removed')).toBe(false);
    expect(recipients.map((r) => r.userId).sort()).toEqual(['other', 'self']);
    // Envelopes wrap the new current key plus the old one (history stays readable).
    expect(buildNoteKeyPayload).toHaveBeenCalledWith(NEW, [OLD]);
    expect(rememberNoteKeyring).toHaveBeenCalledWith('note-l8', NEW, [OLD]);
    // Rust registers current + previous so old v6 rows still decrypt.
    expect(registerSharedSyncKey).toHaveBeenCalledWith('note-l8', NEW, [OLD]);
    expect(sharing.collaborators.value.map((c) => c.userId)).toEqual(['self', 'other']);
  });

  it('surfaces a rotation failure after removal without rolling the removal back', async () => {
    const OLD = 'ab'.repeat(32);
    const api = await import('@/lib/api/collaboration');
    const { getCachedNoteKey } = await import('@/utils/crypto/note-key');
    getCachedNoteKey.mockReturnValue(OLD);
    api.listCollaboratorPublicKeys.mockResolvedValue({
      collaborators: [{ userId: 'other', deviceId: 'd2', kemPublicKey: 'pk', hasEnvelope: true }],
    });
    api.rotateNoteKey.mockRejectedValueOnce(new Error('rotation 500'));

    const sharing = useNoteSharing();
    sharing.collaborators.value = [{ userId: 'removed' }, { userId: 'other' }];

    await sharing.remove('note-rotfail', 'removed');

    expect(api.removeCollaborator).toHaveBeenCalledTimes(1);
    expect(sharing.collaborators.value.map((c) => c.userId)).toEqual(['other']);
    expect(sharing.error.value).toMatch(/rotating the note key failed/i);
  });

  it('does not rotate when the note key is unknown (removal still succeeds)', async () => {
    const api = await import('@/lib/api/collaboration');
    const { getCachedNoteKey, recoverNoteKeyFromEnvelopes, provisionNoteKey } = await import(
      '@/utils/crypto/note-key'
    );
    getCachedNoteKey.mockReturnValue(null);
    recoverNoteKeyFromEnvelopes.mockResolvedValue(null);
    provisionNoteKey.mockResolvedValue(null);

    const sharing = useNoteSharing();
    sharing.key.value = null;
    sharing.collaborators.value = [{ userId: 'removed' }];

    await sharing.remove('note-nokey', 'removed');

    expect(api.removeCollaborator).toHaveBeenCalledTimes(1);
    expect(api.rotateNoteKey).not.toHaveBeenCalled();
  });
});

describe('background envelope recovery keeps the editor off the critical path (L10)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    accountStore.profile = null;
    localStorage.setItem('collaborationEnabled', 'true');
  });

  it('returns without sleeping and recovers the key in the background', async () => {
    provisionNoteKey.mockResolvedValue(null);
    getCollaborationKey.mockResolvedValue({
      wrappedKeys: [{ deviceId: 'd2', wrappedKey: 'wk' }],
      noteHasKey: true,
    });
    recoverNoteKeyFromEnvelopes
      .mockResolvedValueOnce(undefined)
      .mockResolvedValue(NOTE_KEY);

    vi.useFakeTimers();
    try {
      const sharing = useNoteSharing();
      // A background retry must not await its 1s×3 sleeps.
      const result = await sharing.ensureNoteKey('note-bg', { backgroundRetry: true });

      expect(result).toBeNull();
      expect(recoverNoteKeyFromEnvelopes).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(2000);
      expect(recoverNoteKeyFromEnvelopes.mock.calls.length).toBeGreaterThanOrEqual(2);
      expect(sharing.key.value).toBe(NOTE_KEY);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('revoking an invite link', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.setItem('collaborationEnabled', 'true');
  });

  it('restores the row and surfaces the failure when the revoke POST fails', async () => {
    const api = await import('@/lib/api/collaboration');
    api.revokeInviteLink.mockRejectedValueOnce(new Error('network down'));

    const sharing = useNoteSharing();
    sharing.inviteLinks.value = [{ id: 'l1' }, { id: 'l2' }];

    await expect(sharing.revokeLink('note-1', 'l1')).rejects.toThrow('network down');

    expect(sharing.inviteLinks.value.map((l) => l.id)).toEqual(['l1', 'l2']);
    expect(sharing.error.value).toBe('network down');
  });
});

describe('useNoteSharing workspace resolution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    wsState.activeId = null;
    wsState.retrieve = vi.fn(async () => { wsState.activeId = 'ws-9'; });
    api.inviteCollaborator.mockResolvedValue({ userId: 'u1' });
  });

  it('refreshes the workspace list once when activeId is null, then invites with it', async () => {
    const sharing = useNoteSharing();
    await sharing.invite('n1', 'friend@example.com');

    expect(wsState.retrieve).toHaveBeenCalledTimes(1);
    expect(api.inviteCollaborator).toHaveBeenCalledTimes(1);
    expect(api.inviteCollaborator.mock.calls[0][3]).toMatchObject({ workspaceId: 'ws-9' });
  });

  it('maps note_ownership_required to friendly copy, never the raw server string', async () => {
    const raw = 'Only the owner of the workspace that owns this note can claim it.';
    api.inviteCollaborator.mockRejectedValue(
      Object.assign(new Error(raw), { code: 'note_ownership_required' })
    );

    const sharing = useNoteSharing();
    await expect(sharing.invite('n1', 'friend@example.com')).rejects.toThrow();

    expect(sharing.error.value).toBe(NOTE_WORKSPACE_UNCONFIRMED_MESSAGE);
    expect(sharing.error.value).not.toContain(raw);
  });

  it('shows friendly copy when the workspace is still unknown after refreshing', async () => {
    wsState.activeId = null;
    wsState.retrieve = vi.fn(async () => {});
    api.inviteCollaborator.mockRejectedValue(
      Object.assign(new Error('note_ownership_required'), { code: 'note_ownership_required' })
    );

    const sharing = useNoteSharing();
    await expect(sharing.invite('n1', 'friend@example.com')).rejects.toThrow();

    expect(wsState.retrieve).toHaveBeenCalledTimes(1);
    expect(sharing.error.value).toBe(NOTE_WORKSPACE_UNCONFIRMED_MESSAGE);
  });

  it('merges workspace members into collaborators marked viaWorkspace, invite roles win', async () => {
    wsState.activeId = 'ws-9';
    api.listCollaborators.mockResolvedValue([
      { userId: 'u1', username: 'owner', role: 'owner' },
    ]);
    api.getWorkspaceMembers.mockResolvedValue({
      members: [
        { userId: 'u1', username: 'owner', role: 'owner' },
        { userId: 'u2', username: 'teammate', role: 'editor' },
      ],
    });

    const sharing = useNoteSharing();
    await sharing.fetchCollaborators('n1');

    expect(api.getWorkspaceMembers).toHaveBeenCalledWith(
      'ws-9',
      expect.objectContaining({ baseUrl: 'https://sync.test' }),
    );
    expect(sharing.collaborators.value).toEqual([
      expect.objectContaining({ userId: 'u1', role: 'owner' }),
      expect.objectContaining({ userId: 'u2', username: 'teammate', viaWorkspace: true }),
    ]);
    expect(sharing.collaborators.value.find((c) => c.userId === 'u1')).not.toHaveProperty('viaWorkspace');
  });

  it('falls back to workspace members when the note invitations list 403s (workspace-key member)', async () => {
    // Regression: an editor who reads a note via the workspace key is not a
    // per-note invitee, so the invitations endpoint 403s — the share modal
    // used to show nobody and skipped the member merge entirely.
    wsState.activeId = 'ws-9';
    api.listCollaborators.mockRejectedValue(Object.assign(new Error('forbidden'), { status: 403 }));
    api.getWorkspaceMembers.mockResolvedValue({
      members: [{ userId: 'u2', username: 'teammate', role: 'editor' }],
    });

    const sharing = useNoteSharing();
    await sharing.fetchCollaborators('n1');

    expect(api.getWorkspaceMembers).toHaveBeenCalledWith(
      'ws-9',
      expect.objectContaining({ baseUrl: 'https://sync.test' }),
    );
    expect(sharing.collaborators.value).toEqual([
      expect.objectContaining({ userId: 'u2', username: 'teammate', viaWorkspace: true }),
    ]);
    expect(sharing.error.value).toBe('');
  });

  it('keeps per-note invites when the member fetch fails', async () => {
    wsState.activeId = 'ws-9';
    api.listCollaborators.mockResolvedValue([
      { userId: 'u1', username: 'owner', role: 'owner' },
    ]);
    api.getWorkspaceMembers.mockRejectedValue(new Error('offline'));

    const sharing = useNoteSharing();
    await sharing.fetchCollaborators('n1');

    expect(sharing.collaborators.value).toEqual([
      expect.objectContaining({ userId: 'u1', role: 'owner' }),
    ]);
    expect(sharing.error.value).toBe('');
  });
});
