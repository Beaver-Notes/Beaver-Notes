import { describe, it, expect, vi, beforeEach } from 'vitest';

// Residual 2: sharing must resolve the active workspace before inviting, and a
// server `note_ownership_required` refusal must surface actionable copy rather
// than the raw server string.

const wsState = vi.hoisted(() => ({ activeId: null, retrieve: vi.fn() }));
const api = vi.hoisted(() => ({
  inviteCollaborator: vi.fn(),
  generateInviteLink: vi.fn(),
  listCollaborators: vi.fn().mockResolvedValue([]),
}));

vi.mock('@/lib/api/collaboration', () => ({
  createCollaborationKey: vi.fn(),
  getCollaborationKey: vi.fn(),
  listCollaboratorPublicKeys: vi.fn(),
  storeRecipients: vi.fn(),
  rotateNoteKey: vi.fn(),
  inviteCollaborator: api.inviteCollaborator,
  listCollaborators: api.listCollaborators,
  removeCollaborator: vi.fn(),
  generateInviteLink: api.generateInviteLink,
  listInviteLinks: vi.fn(),
  revokeInviteLink: vi.fn(),
  joinViaInviteLink: vi.fn(),
  listNoteJoinRequests: vi.fn(),
  approveNoteJoinRequest: vi.fn(),
  denyNoteJoinRequest: vi.fn(),
}));

vi.mock('@/utils/crypto/note-key', () => ({
  provisionNoteKey: vi.fn(),
  recoverNoteKeyFromEnvelopes: vi.fn(),
  clearUnwrappedKeyCache: vi.fn(),
  wrapNoteKeyForRecipient: vi.fn(),
  getCachedNoteKey: vi.fn(() => null),
  getPreviousNoteKeys: vi.fn(() => []),
  generateNoteKeyHex: vi.fn(),
  buildNoteKeyPayload: vi.fn(),
  rememberNoteKeyring: vi.fn(),
}));

vi.mock('@/utils/sync/shared-keys', () => ({
  registerSharedSyncKey: vi.fn(),
  expectSharedSyncNote: vi.fn(),
}));

vi.mock('@/utils/crypto/identity', () => ({
  loadOrCreateIdentity: vi.fn(),
}));

vi.mock('@/store/account', () => ({
  useAccountStore: () => ({ isAuthenticated: true, serverUrl: 'https://sync.test' }),
}));

vi.mock('@/store/collaborator', () => ({
  useCollaboratorStore: () => ({ setCollaborators: vi.fn(), usernames: [] }),
}));

vi.mock('@/store/workspace', () => ({
  useWorkspaceStore: () => ({
    get activeId() { return wsState.activeId; },
    retrieve: wsState.retrieve,
  }),
}));

import {
  useNoteSharing,
  NOTE_WORKSPACE_UNCONFIRMED_MESSAGE,
} from '@/composable/useNoteSharing';

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
});
