import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/api/client', () => ({
  getApiClient: vi.fn(() => ({
    get: vi.fn(),
    post: vi.fn(),
  })),
}));

vi.mock('@/utils/sync/sync-repository', () => ({
  getSyncDeviceId: () => 'test-device-001',
}));

vi.mock('@/utils/sync/crypto', () => ({
  encryptJSON: vi.fn(async (payload) => {
    const { update } = payload;
    return { v: 3, nonce: 'test-nonce', cipher: btoa(String.fromCharCode(...update)) };
  }),
  decryptJSON: vi.fn(async (raw) => {
    if (typeof raw === 'string') {
      return { content: '<p>Envelope snapshot</p>', title: 'Envelope Note' };
    }
    if (raw?.cipher) {
      const bytes = Uint8Array.from(atob(raw.cipher), (c) => c.charCodeAt(0));
      return { noteId: 'test-note', ts: 1000, update: bytes };
    }
    return raw;
  }),
}));

describe('history API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('createCommit encrypts and POSTs to /commits', async () => {
    const { createCommit } = await import('@/lib/api/history');
    const { getApiClient } = await import('@/lib/api/client');

    const mockPost = vi.fn().mockResolvedValue({ commitId: '123' });
    getApiClient.mockReturnValue({ get: vi.fn(), post: mockPost });

    await createCommit('note-abc', { content: '<p>Hello</p>', title: 'My Note' });

    expect(mockPost).toHaveBeenCalledOnce();
    const [path, body, opts] = mockPost.mock.calls[0];
    expect(path).toBe('/commits');
    expect(body.deviceId).toBe('test-device-001');
    expect(body.payload.v).toBe(3);
    expect(body.payload.nonce).toBe('test-nonce');
    expect(body.id).toMatch(/^\d+-test-device-001-\d+$/);
    expect(opts.headers['X-Note-Id']).toBe('note-abc');
  });

  it('getCommitSnapshot decrypts the server response', async () => {
    const { getCommitSnapshot } = await import('@/lib/api/history');
    const { getApiClient } = await import('@/lib/api/client');

    const snapshot = { content: '<p>Hello world</p>', title: 'Test' };
    const cipher = btoa(JSON.stringify(snapshot));

    getApiClient.mockReturnValue({
      get: vi.fn().mockResolvedValue({ data: { v: 3, nonce: 'n', cipher } }),
      post: vi.fn(),
    });

    const result = await getCommitSnapshot('commit-123', 'note-abc');
    expect(result).toEqual(snapshot);
  });

  it('getCommitSnapshot returns null when decryption fails', async () => {
    const { getCommitSnapshot } = await import('@/lib/api/history');
    const { getApiClient } = await import('@/lib/api/client');
    const { decryptJSON } = await import('@/utils/sync/crypto');

    decryptJSON.mockRejectedValueOnce(new Error('KEY_LOCKED'));

    getApiClient.mockReturnValue({
      get: vi.fn().mockResolvedValue({ data: { v: 3, nonce: 'n', cipher: 'x' } }),
      post: vi.fn(),
    });

    const result = await getCommitSnapshot('commit-456', 'note-abc');
    expect(result).toBeNull();
  });

  it('getCommitSnapshot decrypts a v5 envelope string into the snapshot', async () => {
    const { getCommitSnapshot } = await import('@/lib/api/history');
    const { getApiClient } = await import('@/lib/api/client');

    const envelope = JSON.stringify({ v: 5, meta: {}, iv: 'x', enc: 'y' });
    getApiClient.mockReturnValue({
      get: vi.fn().mockResolvedValue({ data: envelope }),
      post: vi.fn(),
    });

    const result = await getCommitSnapshot('1700000000000-test-device-001-7', 'note-abc');
    expect(result).toEqual({ content: '<p>Envelope snapshot</p>', title: 'Envelope Note' });
  });

  it('listCommits exposes commitId as hash', async () => {
    const { listCommits } = await import('@/lib/api/history');
    const { getApiClient } = await import('@/lib/api/client');

    getApiClient.mockReturnValue({
      get: vi.fn().mockResolvedValue({
        commits: [{ commitId: '1700000000000-dev-1', deviceId: 'dev', clock: 1, ts: 1700000000000 }],
      }),
      post: vi.fn(),
    });

    const commits = await listCommits('ws', 'note-abc');
    expect(commits[0].hash).toBe('1700000000000-dev-1');
  });
});
