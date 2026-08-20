import { describe, it, expect, vi } from 'vitest';

vi.mock('@/store/account', () => ({
  accountStore: { isAuthenticated: true },
}));
vi.mock('@/lib/api/collaboration', () => ({
  listKeyDistributionRequests: vi.fn(),
  getCollaborationKey: vi.fn(),
  storeRecipients: vi.fn().mockResolvedValue({}),
  deleteKeyDistributionRequest: vi.fn().mockResolvedValue({}),
}));
vi.mock('@/utils/crypto/note-key', () => ({
  recoverNoteKeyFromEnvelopes: vi.fn(),
  wrapNoteKeyForRecipient: vi.fn().mockResolvedValue('ENV'),
}));

import { fulfillPendingRequests } from '@/composable/useKeyDistributor';

describe('key distributor', () => {
  it('wraps the note key for the target device and deletes the request', async () => {
    const { listKeyDistributionRequests, getCollaborationKey, storeRecipients, deleteKeyDistributionRequest } =
      await import('@/lib/api/collaboration');
    const { recoverNoteKeyFromEnvelopes, wrapNoteKeyForRecipient } = await import('@/utils/crypto/note-key');

    listKeyDistributionRequests.mockResolvedValue({
      requests: [{ noteId: 'n1', userId: 'u1', targetDeviceId: 'dev-b' }],
    });
    getCollaborationKey.mockResolvedValue({
      wrappedKeys: [{ deviceId: 'dev-a', wrappedKey: 'ENV_A' }],
    });
    recoverNoteKeyFromEnvelopes.mockResolvedValue('NOTEKEY');
    wrapNoteKeyForRecipient.mockResolvedValue('ENV_B');

    const identity = { publicKeyHex: 'K', privateKeyHex: 'P' };

    await fulfillPendingRequests({ identity, myDeviceId: 'dev-a', targetPublicKeys: { 'dev-b': 'KB' } });

    expect(storeRecipients.mock.calls[0][0]).toBe('n1');
    expect(storeRecipients.mock.calls[0][1][0].deviceId).toBe('dev-b');
    expect(storeRecipients.mock.calls[0][1][0].wrappedKey).toBe('ENV_B');
    expect(deleteKeyDistributionRequest.mock.calls[0][0]).toBe('n1');
    expect(deleteKeyDistributionRequest.mock.calls[0][1]).toBe('dev-b');
  });
});
