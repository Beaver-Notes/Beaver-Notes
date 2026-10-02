import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';

const noteKeyCtl = vi.hoisted(() => ({ key: null }));

vi.mock('@/composable/useNoteSharing', () => ({
  useNoteSharing: () => ({ ensureNoteKey: async () => noteKeyCtl.key }),
}));

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
      return {
        noteId: 'note-abc',
        ts: 1000,
        update: new TextEncoder().encode(
          JSON.stringify({ content: '<p>Envelope snapshot</p>', title: 'Envelope Note' })
        ),
      };
    }
    return raw;
  }),
}));

describe('history API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    noteKeyCtl.key = null;
    // history.js resolves the account's serverUrl from the store.
    setActivePinia(createPinia());
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

  it('getCommitSnapshot decrypts the server response and binds noteId as AAD', async () => {
    const { getCommitSnapshot } = await import('@/lib/api/history');
    const { getApiClient } = await import('@/lib/api/client');
    const { decryptJSON } = await import('@/utils/sync/crypto');

    const envelope = JSON.stringify({ v: 5, meta: {}, iv: 'x', enc: 'y' });
    getApiClient.mockReturnValue({
      get: vi.fn().mockResolvedValue({ data: envelope }),
      post: vi.fn(),
    });

    const result = await getCommitSnapshot('commit-123', 'note-abc');
    expect(decryptJSON).toHaveBeenCalledWith(envelope, 'note-abc');
    expect(result).toEqual({ content: '<p>Envelope snapshot</p>', title: 'Envelope Note' });
  });

  it('getCommitSnapshot returns null when decryption fails', async () => {
    const { getCommitSnapshot } = await import('@/lib/api/history');
    const { getApiClient } = await import('@/lib/api/client');
    const { decryptJSON } = await import('@/utils/sync/crypto');

    decryptJSON.mockRejectedValueOnce(new Error('KEY_LOCKED'));

    const envelope = JSON.stringify({ v: 5, meta: {}, iv: 'x', enc: 'y' });
    getApiClient.mockReturnValue({
      get: vi.fn().mockResolvedValue({ data: envelope }),
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

  it('createCommit encrypts with the shared note key (v6) when one exists', async () => {
    const { createCommit } = await import('@/lib/api/history');
    const { getApiClient } = await import('@/lib/api/client');

    noteKeyCtl.key = 'ab'.repeat(32);
    const mockPost = vi.fn().mockResolvedValue({ commitId: '123' });
    getApiClient.mockReturnValue({ get: vi.fn(), post: mockPost });

    await createCommit('note-abc', { content: '<p>Hello v6</p>', title: 'V6' });

    const [, body] = mockPost.mock.calls[0];
    const parsed = JSON.parse(body.payload);
    expect(parsed.v).toBe(6);
    expect(parsed.k).toBe('note');
    expect(parsed.noteId).toBe('note-abc');
    expect(parsed.device).toBe('test-device-001');
    expect(typeof parsed.data).toBe('string');
  });

  it('getCommitSnapshot decrypts a v6 note-key envelope with the per-note key', async () => {
    const { createCommit, getCommitSnapshot } = await import('@/lib/api/history');
    const { getApiClient } = await import('@/lib/api/client');

    noteKeyCtl.key = 'cd'.repeat(32);
    const mockPost = vi.fn().mockResolvedValue({ commitId: '123' });
    const mockGet = vi.fn().mockResolvedValue({ data: null });
    getApiClient.mockReturnValue({ get: mockGet, post: mockPost });

    const snapshot = { content: '<p>Round trip</p>', title: 'RT' };
    await createCommit('note-abc', snapshot);
    mockGet.mockResolvedValue({ data: mockPost.mock.calls[0][1].payload });

    await expect(getCommitSnapshot('commit-1', 'note-abc')).resolves.toEqual(snapshot);
  });

  it('getCommitSnapshot returns null for a v6 envelope when no note key is available', async () => {
    const { getCommitSnapshot } = await import('@/lib/api/history');
    const { getApiClient } = await import('@/lib/api/client');

    noteKeyCtl.key = null;
    const envelope = JSON.stringify({ v: 6, k: 'note', noteId: 'note-abc', data: 'AAAA' });
    getApiClient.mockReturnValue({
      get: vi.fn().mockResolvedValue({ data: envelope }),
      post: vi.fn(),
    });

    await expect(getCommitSnapshot('commit-1', 'note-abc')).resolves.toBeNull();
  });
});
