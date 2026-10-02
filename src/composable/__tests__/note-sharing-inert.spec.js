import { describe, it, expect, vi, beforeEach } from 'vitest';

// Full API-layer mock: proves ensureNoteKey makes zero collaboration calls on
// personal notes. The legacy request-queue exports are deliberately absent:
// they must no longer exist as exports at all.
vi.mock('@/lib/api/collaboration', () => ({
  createCollaborationKey: vi.fn().mockResolvedValue({}),
  getCollaborationKey: vi.fn().mockResolvedValue({ wrappedKeys: [], noteHasKey: false }),
  listCollaboratorPublicKeys: vi.fn().mockResolvedValue({ collaborators: [] }),
  storeRecipients: vi.fn().mockResolvedValue({ existing: false }),
  rotateNoteKey: vi.fn().mockResolvedValue({ stored: 1, generation: 1 }),
  inviteCollaborator: vi.fn().mockResolvedValue({}),
  listCollaborators: vi.fn().mockResolvedValue([]),
  removeCollaborator: vi.fn().mockResolvedValue({}),
  generateInviteLink: vi.fn().mockResolvedValue({}),
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

import { useNoteSharing } from '@/composable/useNoteSharing';
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
    expect(registerSharedSyncKey).toHaveBeenCalledWith('note-shared', NOTE_KEY, []);
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
      expect(registerSharedSyncKey).toHaveBeenCalledWith('note-transient', NOTE_KEY, []);
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
