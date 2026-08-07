import { describe, expect, it, vi, beforeEach } from 'vitest';
import { CloudTransport } from '../../transports/cloud.js';

vi.mock('../../remote-yjs.js', () => ({
  pushUpdates: vi.fn(() => ({ stored: 0, skipped: 0, sizeBytes: 0 })),
  pullUpdates: vi.fn(() => ({})),
}));

vi.mock('../../path.js', () => ({
  getSyncPath: vi.fn(() => '/mock/sync'),
}));

vi.mock('../../sync-repository.js', () => ({
  ensureCommitsDir: vi.fn(() => '/mock/commits'),
  getSyncDeviceId: vi.fn(() => 'mock-device'),
}));

vi.mock('../../sync-yjs.js', () => ({
  parseSyncFilename: vi.fn(),
}));

vi.mock('@/lib/native/fs', () => ({
  readDir: vi.fn(),
  readFile: vi.fn(),
  pathExists: vi.fn(() => Promise.resolve(true)),
}));

vi.mock('@/lib/tauri-bridge', () => ({
  path: { join: (...args) => args.join('/') },
}));

vi.mock('../../constants.js', () => ({
  YJS_UPDATE_EXT: '.yjs.json',
}));

vi.mock('../../crypto.js', () => ({
  decryptJSON: vi.fn((raw, _aad) => JSON.parse(atob(raw))),
}));

vi.mock('../../compression.js', () => ({
  compressGzip: vi.fn((buf) => buf),
  decompressGzip: vi.fn((buf) => buf),
  isGzipCompressed: vi.fn(() => false),
}));

describe('CloudTransport', () => {
  const defaultAccountState = () => ({ isAuth: true, plan: 'basic' });
  let transport;

  beforeEach(() => {
    vi.clearAllMocks();
    transport = new CloudTransport({
      passphraseProvider: vi.fn(() => 'mock-pass'),
      getTransportSetting: () => 'both',
      getAccountState: defaultAccountState,
    });
  });

  describe('push throttle', () => {
    it('first call never throttled', async () => {
      const { readDir } = await import('@/lib/native/fs');
      readDir.mockResolvedValue([]);
      const result = await transport.push({});
      expect(result.throttled).toBeUndefined();
    });

    it('returns throttled=true within 30s of last push', async () => {
      const { readDir } = await import('@/lib/native/fs');
      readDir.mockResolvedValue([]);
      await transport.push({});
      const result = await transport.push({});
      expect(result.throttled).toBe(true);
    });

    it('force:true bypasses throttle', async () => {
      const { readDir } = await import('@/lib/native/fs');
      readDir.mockResolvedValue([]);
      await transport.push({});
      const result = await transport.push({}, { force: true });
      expect(result.throttled).toBeUndefined();
    });
  });

  describe('push authorization', () => {
    it('no-op when setting is FOLDER', async () => {
      const localTransport = new CloudTransport({
        passphraseProvider: vi.fn(),
        getTransportSetting: () => 'folder',
        getAccountState: defaultAccountState,
      });
      const result = await localTransport.push({});
      expect(result.pushed).toBe(0);
    });

    it('no-op when not authenticated', async () => {
      const unAuthTransport = new CloudTransport({
        passphraseProvider: vi.fn(),
        getTransportSetting: () => 'both',
        getAccountState: () => ({ isAuth: false, plan: 'basic' }),
      });
      const result = await unAuthTransport.push({});
      expect(result.pushed).toBe(0);
    });

    it('no-op when plan is free', async () => {
      const freeTransport = new CloudTransport({
        passphraseProvider: vi.fn(),
        getTransportSetting: () => 'both',
        getAccountState: () => ({ isAuth: true, plan: 'free' }),
      });
      const result = await freeTransport.push({});
      expect(result.pushed).toBe(0);
    });

    it('re-checks _remoteAllowed each call', async () => {
      let plan = 'basic';
      const downgradableTransport = new CloudTransport({
        passphraseProvider: vi.fn(),
        getTransportSetting: () => 'both',
        getAccountState: () => ({ isAuth: true, plan }),
      });
      const { readDir } = await import('@/lib/native/fs');
      readDir.mockResolvedValue([]);
      await downgradableTransport.push({});
      plan = 'free';
      const result = await downgradableTransport.push({}, { force: true });
      expect(result.pushed).toBe(0);
    });
  });

  describe('push batching', () => {
    it('batches up to 50 files per POST', async () => {
      const { readDir, readFile } = await import('@/lib/native/fs');
      const { parseSyncFilename } = await import('../../sync-yjs.js');
      const { pushUpdates } = await import('../../remote-yjs.js');

      readDir.mockResolvedValue(Array.from({ length: 55 }, (_, i) => `note-a~~mock-device~~200~~${i}.yjs.json`));
      readFile.mockResolvedValue('encrypted-content');
      parseSyncFilename.mockImplementation((file) => {
        const match = file.match(/~~(\d+)\.yjs\.json$/) || file.match(/~~(\d+)~~(\d+)\.yjs\.json$/);
        return { docId: 'note-a', isSnapshot: false, device: 'mock-device', ts: 200, seq: parseInt(match?.[1] || '0') };
      });

      await transport.push({});

      expect(pushUpdates.mock.calls.length).toBeGreaterThanOrEqual(1);
    });

    it('sends a >256 KiB file solo in its own POST', async () => {
      const { readDir, readFile } = await import('@/lib/native/fs');
      const { parseSyncFilename } = await import('../../sync-yjs.js');
      const { pushUpdates } = await import('../../remote-yjs.js');

      readDir.mockResolvedValue(['note-a~~mock-device~~200.yjs.json', 'note-b~~mock-device~~201.yjs.json']);
      readFile
        .mockResolvedValueOnce('x'.repeat(300 * 1024))
        .mockResolvedValueOnce('small-content');
      parseSyncFilename.mockImplementation((file) => {
        const ts = file.includes('200') ? 200 : 201;
        return { docId: 'note-a', isSnapshot: false, device: 'mock-device', ts, seq: 0 };
      });

      await transport.push({});
      const firstCallArgs = pushUpdates.mock.calls[0];
      const notes = firstCallArgs[1];
      expect(notes.length).toBe(1);
    });

    it('advances own device cursor for pushed files', async () => {
      const { readDir, readFile } = await import('@/lib/native/fs');
      const { parseSyncFilename } = await import('../../sync-yjs.js');
      readDir.mockResolvedValue(['note-a~~mock-device~~200~~5.yjs.json']);
      readFile.mockResolvedValue('data');
      parseSyncFilename.mockReturnValue({ docId: 'note-a', isSnapshot: false, device: 'mock-device', ts: 200, seq: 5 });

      const cursors = {};
      const result = await transport.push(cursors);

      expect(result.cursorsDelta['yjs-mock-device']).toEqual({ ts: 200, seq: 5 });
    });
  });

  describe('pull', () => {
    it('no-op when remote not allowed', async () => {
      const localTransport = new CloudTransport({
        passphraseProvider: vi.fn(),
        getTransportSetting: () => 'folder',
        getAccountState: () => ({ isAuth: true, plan: 'basic' }),
      });
      const result = await localTransport.pull({});
      expect(result.updates).toEqual([]);
    });

    it('decrypts and returns updates from remotePullUpdates', async () => {
      const { pullUpdates } = await import('../../remote-yjs.js');
      const { decryptJSON } = await import('../../crypto.js');

      const updatePayload = { device: 'remote-device', ts: 100, seq: 0, noteId: 'note-a', update: [1, 2, 3] };
      const base64Data = btoa(JSON.stringify(updatePayload));

      pullUpdates.mockResolvedValue({
        'note-a': [{ key: 'note-a~~remote-device~~100.yjs.json', data: base64Data }],
      });

      const { parseSyncFilename } = await import('../../sync-yjs.js');
      parseSyncFilename.mockReturnValue({ docId: 'note-a', isSnapshot: false, device: 'remote-device', ts: 100, seq: 0 });

      decryptJSON.mockResolvedValue(updatePayload);

      const result = await transport.pull({});
      expect(result.updates).toHaveLength(1);
      expect(result.updates[0].noteId).toBe('note-a');
      expect(result.updates[0].device).toBe('remote-device');
    });

    it('skips entries that fail decrypt', async () => {
      const { pullUpdates } = await import('../../remote-yjs.js');
      const { decryptJSON } = await import('../../crypto.js');

      pullUpdates.mockResolvedValue({
        'bad': [{ key: 'bad.yjs.json', data: btoa('invalid') }],
      });

      const { parseSyncFilename } = await import('../../sync-yjs.js');
      parseSyncFilename.mockReturnValue({ docId: 'bad', isSnapshot: false, device: 'remote-device', ts: 50, seq: 0 });

      decryptJSON.mockRejectedValue(new Error('decrypt failed'));

      const result = await transport.pull({});
      expect(result.updates).toEqual([]);
    });
  });

  describe('seedOnce/compact', () => {
    it('both are no-ops', async () => {
      await expect(transport.seedOnce()).resolves.not.toThrow();
      await expect(transport.compact()).resolves.not.toThrow();
    });
  });
});
