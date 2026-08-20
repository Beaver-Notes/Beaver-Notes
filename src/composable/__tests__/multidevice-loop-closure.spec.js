import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the backend API layer entirely (no live server, no cloud.js).
vi.mock('@/lib/api/collaboration', () => ({
  createCollaborationKey: vi.fn().mockResolvedValue({}),
  getCollaborationKey: vi.fn().mockResolvedValue({ wrappedKeys: [], noteHasKey: true }),
  listCollaboratorPublicKeys: vi.fn().mockResolvedValue({ collaborators: [] }),
  storeRecipients: vi.fn().mockResolvedValue({ existing: false }),
  inviteCollaborator: vi.fn().mockResolvedValue({}),
  listCollaborators: vi.fn().mockResolvedValue([]),
  removeCollaborator: vi.fn().mockResolvedValue({}),
  generateInviteLink: vi.fn().mockResolvedValue({}),
  listInviteLinks: vi.fn().mockResolvedValue([]),
  revokeInviteLink: vi.fn().mockResolvedValue({}),
  joinViaInviteLink: vi.fn().mockResolvedValue({}),
  requestKeyDistribution: vi.fn().mockResolvedValue({ ok: true }),
  listKeyDistributionRequests: vi.fn().mockResolvedValue({ requests: [] }),
  deleteKeyDistributionRequest: vi.fn().mockResolvedValue({ ok: true }),
}));

// Keep REAL generateIdentity / wrap / unwrap crypto, but make identity
// persistence (safeStorage) a controllable stub so useNoteSharing's
// loadOrCreateIdentity returns our real device-B keypair.
vi.mock('@/utils/crypto/identity', async (importActual) => {
  const actual = await importActual();
  return { ...actual, loadOrCreateIdentity: vi.fn() };
});

vi.mock('@/store/account', () => ({
  useAccountStore: () => ({ isAuthenticated: true, serverUrl: 'https://sync.test' }),
  accountStore: { isAuthenticated: true, serverUrl: 'https://sync.test' },
}));
vi.mock('@/store/collaborator', () => ({
  useCollaboratorStore: () => ({ setCollaborators: vi.fn() }),
}));
vi.mock('@/lib/account-storage', () => ({
  loadAccountDeviceId: vi.fn(() => 'dev-b'),
  saveAccountDeviceId: vi.fn(),
}));

import {
  provisionNoteKey,
  recoverNoteKeyFromEnvelopes,
  wrapNoteKeyForRecipient,
  unwrapNoteKey,
  clearUnwrappedKeyCache,
} from '@/utils/crypto/note-key';
import { generateIdentity, loadOrCreateIdentity } from '@/utils/crypto/identity';
import { useNoteSharing } from '@/composable/useNoteSharing';
import { fulfillPendingRequests } from '@/composable/useKeyDistributor';

describe('multi-device note-key fan-out + distribution loop closure', () => {
  let identityA, identityB;
  let provisionedKey, aEnvelope, bEnvelope;

  beforeEach(() => {
    vi.clearAllMocks();
    clearUnwrappedKeyCache();
  });

  it('step 1: device A provisions and fans out to every device key', async () => {
    identityA = await generateIdentity();
    identityB = await generateIdentity();

    const { storeRecipients } = await import('@/lib/api/collaboration');
    storeRecipients.mockClear();

    provisionedKey = await provisionNoteKey({
      getKey: async () => ({ noteHasKey: false }),
      listPublicKeys: async () => ({
        collaborators: [
          { userId: 'u1', deviceId: 'dev-a', kemPublicKey: identityA.publicKeyHex },
          { userId: 'u1', deviceId: 'dev-b', kemPublicKey: identityB.publicKeyHex },
        ],
      }),
      storeRecipients: (rs) => {
        storeRecipients(rs);
        return { existing: false };
      },
      identity: identityA,
      noteId: 'note-x',
    });

    expect(provisionedKey).toMatch(/^[0-9a-f]{64}$/);
    expect(storeRecipients).toHaveBeenCalledTimes(1);

    const recipients = storeRecipients.mock.calls[0][0];
    expect(recipients).toHaveLength(2);
    const devA = recipients.find((r) => r.deviceId === 'dev-a');
    const devB = recipients.find((r) => r.deviceId === 'dev-b');
    expect(devA).toBeTruthy();
    expect(devB).toBeTruthy();

    // Each envelope must open with its corresponding device's private key.
    const aRecovered = await unwrapNoteKey(identityA.privateKeyHex, devA.wrappedKey);
    const bRecovered = await unwrapNoteKey(identityB.privateKeyHex, devB.wrappedKey);
    expect(aRecovered).toBe(provisionedKey);
    expect(bRecovered).toBe(provisionedKey);

    aEnvelope = devA.wrappedKey;
    bEnvelope = devB.wrappedKey;
  });

  it('step 2: device B recovers the SAME note key from its fans-out envelope', async () => {
    const raw = {
      wrappedKeys: [
        { deviceId: 'dev-a', wrappedKey: aEnvelope },
        { deviceId: 'dev-b', wrappedKey: bEnvelope },
      ],
      noteHasKey: true,
    };
    const recovered = await recoverNoteKeyFromEnvelopes(raw.wrappedKeys, identityB, 'note-x');
    expect(recovered).toBe(provisionedKey);
  });

  it('step 3: late joiner with no envelope requests distribution and returns null', async () => {
    const {
      getCollaborationKey,
      createCollaborationKey,
      listCollaboratorPublicKeys,
      requestKeyDistribution,
    } = await import('@/lib/api/collaboration');
    const { loadOrCreateIdentity: loc } = await import('@/utils/crypto/identity');

    vi.mocked(loc).mockResolvedValue(identityB);
    // Note exists (has a key) but device B has no envelope yet.
    getCollaborationKey.mockResolvedValue({ wrappedKeys: [], noteHasKey: false });
    createCollaborationKey.mockResolvedValue({});
    // Late joiner cannot even see collaborators to fan-out to, so provision
    // cannot happen and the device must request redistribution.
    listCollaboratorPublicKeys.mockResolvedValue({ collaborators: [] });
    requestKeyDistribution.mockResolvedValue({ ok: true });

    const sharing = useNoteSharing();
    const result = await sharing.ensureNoteKey('note-x');

    expect(requestKeyDistribution).toHaveBeenCalledWith('note-x', 'dev-b');
    expect(result).toBeNull();
  });

  it('step 4: an online device fulfills the request and device B can then recover', async () => {
    const {
      getCollaborationKey,
      storeRecipients,
      listKeyDistributionRequests,
      deleteKeyDistributionRequest,
    } = await import('@/lib/api/collaboration');
    storeRecipients.mockClear();

    // Distributor reads device A's existing envelope to recover the note key.
    getCollaborationKey.mockResolvedValue({
      wrappedKeys: [{ deviceId: 'dev-a', wrappedKey: aEnvelope }],
    });
    listKeyDistributionRequests.mockResolvedValue({
      requests: [{ noteId: 'note-x', userId: 'u1', targetDeviceId: 'dev-b' }],
    });
    deleteKeyDistributionRequest.mockResolvedValue({});

    await fulfillPendingRequests({
      identity: identityA,
      resolvePublicKey: (noteId, targetDeviceId) => identityB.publicKeyHex,
      baseUrl: 'https://sync.test',
    });

    // (a) storeRecipients wraps the note key for dev-b with B's public key.
    expect(storeRecipients).toHaveBeenCalledTimes(1);
    const call = storeRecipients.mock.calls[0];
    expect(call[0]).toBe('note-x');
    const recipient = call[1][0];
    expect(recipient.userId).toBe('u1');
    expect(recipient.deviceId).toBe('dev-b');

    const bRecovered = await unwrapNoteKey(identityB.privateKeyHex, recipient.wrappedKey);
    expect(bRecovered).toBe(provisionedKey);

    // (b) the distribution request is deleted after fulfillment.
    expect(deleteKeyDistributionRequest.mock.calls[0][0]).toBe('note-x');
    expect(deleteKeyDistributionRequest.mock.calls[0][1]).toBe('dev-b');

    // Re-run step 2's recovery with the newly stored B envelope.
    const after = await recoverNoteKeyFromEnvelopes(
      [{ deviceId: 'dev-b', wrappedKey: recipient.wrappedKey }],
      identityB,
      'note-x'
    );
    expect(after).toBe(provisionedKey);
  });
});
