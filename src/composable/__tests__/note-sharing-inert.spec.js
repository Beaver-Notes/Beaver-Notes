import { describe, it, expect, vi, beforeEach } from 'vitest';

// Full API-layer mock: proves ensureNoteKey makes zero collaboration calls on
// personal notes. The legacy request-queue exports are deliberately absent —
// they must no longer exist as exports at all.
vi.mock('@/lib/api/collaboration', () => ({
  createCollaborationKey: vi.fn().mockResolvedValue({}),
  getCollaborationKey: vi.fn().mockResolvedValue({ wrappedKeys: [], noteHasKey: false }),
  listCollaboratorPublicKeys: vi.fn().mockResolvedValue({ collaborators: [] }),
  storeRecipients: vi.fn().mockResolvedValue({ existing: false }),
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
}));

vi.mock('@/utils/crypto/identity', () => ({
  loadOrCreateIdentity: vi.fn(async () => ({
    publicKeyHex: 'aa'.repeat(32),
    privateKeyHex: 'bb'.repeat(32),
  })),
}));

vi.mock('@/store/account', () => ({
  useAccountStore: () => ({ isAuthenticated: true, serverUrl: 'https://sync.test' }),
  accountStore: { isAuthenticated: true, serverUrl: 'https://sync.test' },
}));

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
  storeRecipients,
} from '@/lib/api/collaboration';
import { provisionNoteKey } from '@/utils/crypto/note-key';

const NOTE_KEY = 'ab'.repeat(32);

describe('personal notes keep ML-KEM fan-out inert', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
    expect(info).toHaveBeenCalledWith('[notes] sharing arrives with teams phase');
    info.mockRestore();
  });
});
