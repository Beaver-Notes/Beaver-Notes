import { describe, expect, it, vi, beforeEach } from 'vitest';
import { CloudTransport } from '../../transports/cloud.js';

vi.mock('@/store/workspace.ts', () => ({
  useWorkspaceStore: vi.fn(() => ({ activeId: 'workspace-1', workspaces: [] })),
}));

vi.mock('../../remote-yjs.js', () => ({
  pushUpdates: vi.fn(() => ({ accepted: 0, duplicate: 0, checkpoint: null })),
  pullUpdates: vi.fn(() => ({ notes: {} })),
  getRemoteState: vi.fn(() => ({ status: 'empty', documents: [] })),
  claimInitialization: vi.fn(() => ({ token: 'claim-token' })),
  uploadInitializationSnapshot: vi.fn((workspaceId, _token, noteId) => ({ key: `yjs/${workspaceId}/${noteId}/1.yjs` })),
  completeInitialization: vi.fn(() => ({ ok: true })),
  listRemoteNoteIds: vi.fn(() => []),
}));

vi.mock('../../path.js', () => ({
  getSyncPath: vi.fn(() => '/mock/sync'),
}));

vi.mock('../../sync-repository.js', () => ({
  ensureCommitsDir: vi.fn(() => '/mock/commits'),
  getSyncDeviceId: vi.fn(() => 'mock-device'),
  getCommitsDir: vi.fn(() => '/mock/commits'),
}));

vi.mock('../../sync-yjs.js', () => ({
  parseSyncFilename: vi.fn(),
}));

vi.mock('@/lib/native/fs', () => ({
  readDir: vi.fn(),
  readFile: vi.fn(),
  pathExists: vi.fn(() => Promise.resolve(true)),
}));

vi.mock('@/lib/native/app', () => ({
  getAppDirectory: vi.fn(() => null),
}));

vi.mock('@/lib/tauri-bridge', () => ({
  path: { join: (...args) => args.join('/') },
}));

vi.mock('../../constants.js', () => ({
  YJS_UPDATE_EXT: '.yjs.json',
}));

vi.mock('../../crypto.js', () => ({
  encryptJSON: vi.fn(() => 'encrypted'),
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
      const { pushUpdates } = await import('../../remote-yjs.js');
      pushUpdates.mockResolvedValue({ accepted: 1, duplicate: 0, checkpoint: { ts: 200, sequence: 5, deviceId: 'mock-device' } });

      const cursors = {};
      const result = await transport.push(cursors);

      expect(result.cursorsDelta).toEqual({
        'workspace-1': { 'note-a': { 'mock-device': { ts: 200, sequence: 5 } } },
      });
    });
  });

  describe('pull', () => {
    it.each([
      undefined,
      null,
      {},
      { status: 'unknown', documents: [] },
      { status: 'initialized', documents: 'not-an-array' },
    ])('rejects malformed remote state as a retryable pull error: %o', async (state) => {
      const { getRemoteState, pullUpdates } = await import('../../remote-yjs.js');
      getRemoteState.mockResolvedValue(state);

      await expect(transport.pull({})).rejects.toThrow('Remote sync state payload is malformed');
      expect(pullUpdates).not.toHaveBeenCalled();
    });

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
      const { getRemoteState } = await import('../../remote-yjs.js');
      const { decryptJSON } = await import('../../crypto.js');

      const updatePayload = { device: 'remote-device', ts: 100, sequence: 3, noteId: 'note-a', update: [1, 2, 3] };
      const base64Data = btoa(JSON.stringify(updatePayload));

      pullUpdates.mockResolvedValue({
        notes: {
          'note-a': {
            updates: [{ key: 'note-a~~remote-device~~100~~3.yjs.json', data: base64Data }],
            nextCheckpoint: { ts: 100, sequence: 3, deviceId: 'remote-device' },
            hasMore: false,
          },
        },
      });
      getRemoteState.mockResolvedValue({ status: 'initialized', documents: [{ noteId: 'note-a' }] });

      const { parseSyncFilename } = await import('../../sync-yjs.js');
      parseSyncFilename.mockReturnValue({ docId: 'note-a', isSnapshot: false, device: 'remote-device', ts: 100, seq: 3 });

      decryptJSON.mockResolvedValue(updatePayload);

      const result = await transport.pull({});
      expect(result.updates).toHaveLength(1);
      expect(result.updates[0].noteId).toBe('note-a');
      expect(result.updates[0].device).toBe('remote-device');
      expect(result.cursorsDelta).toEqual({
        'workspace-1': { 'note-a': { 'remote-device': { ts: 100, sequence: 3 } } },
      });
    });

    it('skips entries that fail decrypt', async () => {
      const { pullUpdates } = await import('../../remote-yjs.js');
      const { getRemoteState } = await import('../../remote-yjs.js');
      const { decryptJSON } = await import('../../crypto.js');

      pullUpdates.mockResolvedValue({
        notes: {
          bad: {
            updates: [{ key: 'bad.yjs.json', data: btoa('invalid') }],
            nextCheckpoint: null,
            hasMore: false,
          },
        },
      });
      getRemoteState.mockResolvedValue({ status: 'initialized', documents: [{ noteId: 'bad' }] });

      const { parseSyncFilename } = await import('../../sync-yjs.js');
      parseSyncFilename.mockReturnValue({ docId: 'bad', isSnapshot: false, device: 'remote-device', ts: 50, seq: 0 });

      decryptJSON.mockRejectedValue(new Error('decrypt failed'));

      await expect(transport.pull({})).rejects.toMatchObject({ code: 'unlock-required' });
    });

    it('discovers notes from remote workspace state without reading the folder transport', async () => {
      const { getRemoteState, pullUpdates } = await import('../../remote-yjs.js');
      const { readDir } = await import('@/lib/native/fs');
      getRemoteState.mockResolvedValue({ status: 'initialized', documents: [{ noteId: 'server-note' }] });
      pullUpdates.mockResolvedValue({ notes: { 'server-note': { updates: [], nextCheckpoint: null, hasMore: false } } });

      await transport.pull({});

      expect(getRemoteState).toHaveBeenCalled();
      expect(pullUpdates).toHaveBeenCalledWith('workspace-1', expect.arrayContaining([
        expect.objectContaining({ noteId: 'server-note', checkpoint: {} }),
      ]));
      expect(readDir).not.toHaveBeenCalled();
    });

    it('returns one continuation page and its cursor delta', async () => {
      const { pullUpdates } = await import('../../remote-yjs.js');
      pullUpdates
        .mockResolvedValueOnce({ notes: { note: {
          updates: [],
          nextCheckpoint: { ts: 1, sequence: 1, deviceId: 'remote-device' },
          hasMore: true,
        } } });

      const result = await transport.pull({ 'workspace-1': { note: { 'remote-device': { ts: 0, sequence: 0 } } } });

      expect(pullUpdates).toHaveBeenCalledTimes(1);
      expect(result.cursorsDelta['workspace-1'].note['remote-device']).toEqual({ ts: 1, sequence: 1 });
      expect(result.hasMore).toBe(true);
    });

    it('discovers a newly created server note when local cursors already exist', async () => {
      const { getRemoteState, pullUpdates } = await import('../../remote-yjs.js');
      getRemoteState.mockResolvedValue({ status: 'initialized', documents: [{ noteId: 'later-note' }] });
      pullUpdates.mockResolvedValue({ notes: {
        note: { updates: [], hasMore: false },
        'later-note': { updates: [], hasMore: false },
      } });

      await transport.pull({ 'workspace-1': { note: {} } });

      expect(pullUpdates).toHaveBeenCalledWith('workspace-1', expect.arrayContaining([
        expect.objectContaining({ noteId: 'later-note' }),
      ]));
    });

    it('does not return a cursor for a malformed update payload', async () => {
      const { getRemoteState, pullUpdates } = await import('../../remote-yjs.js');
      getRemoteState.mockResolvedValue({ status: 'initialized', documents: [{ noteId: 'bad' }] });
      pullUpdates.mockResolvedValue({ notes: {
        bad: {
          updates: [{ key: 'bad~~device~~1~~1.yjs.json', data: btoa(JSON.stringify({ nope: true })) }],
          nextCheckpoint: { ts: 1, sequence: 1, deviceId: 'device' },
          hasMore: false,
        },
      } });
      const { parseSyncFilename } = await import('../../sync-yjs.js');
      parseSyncFilename.mockReturnValue({ docId: 'bad', isSnapshot: false, device: 'device', ts: 1, seq: 1 });

      await expect(transport.pull({})).rejects.toMatchObject({ code: 'unlock-required' });
    });

    it.each([
      ['noteId', { noteId: 'other' }],
      ['device', { device: 'other' }],
      ['timestamp', { ts: 2 }],
      ['sequence', { sequence: 2 }],
    ])('rejects a pulled update with a mismatched %s and does not advance its page', async (_field, change) => {
      const { getRemoteState, pullUpdates } = await import('../../remote-yjs.js');
      const { parseSyncFilename } = await import('../../sync-yjs.js');
      getRemoteState.mockResolvedValue({ status: 'initialized', documents: [{ noteId: 'note-a' }] });
      parseSyncFilename.mockReturnValue({ docId: 'note-a', isSnapshot: false, device: 'device-a', ts: 1, seq: 1 });
      pullUpdates.mockResolvedValue({ notes: {
        'note-a': {
          updates: [{ key: 'note-a~~device-a~~1~~1.yjs.json', data: btoa(JSON.stringify({
            noteId: 'note-a', device: 'device-a', ts: 1, sequence: 1, update: [1], ...change,
          })) }],
          nextCheckpoint: { deviceId: 'device-a', ts: 1, sequence: 1 },
          hasMore: true,
        },
      } });

      await expect(transport.pull({})).rejects.toMatchObject({ code: 'unlock-required' });
    });

    it.each([
      ['timestamp', { ts: Number.NaN }],
      ['sequence', { sequence: -1 }],
      ['update payload', { update: 'not-binary' }],
    ])('rejects a pulled update with an invalid %s', async (_field, change) => {
      const { getRemoteState, pullUpdates } = await import('../../remote-yjs.js');
      const { parseSyncFilename } = await import('../../sync-yjs.js');
      getRemoteState.mockResolvedValue({ status: 'initialized', documents: [{ noteId: 'note-a' }] });
      parseSyncFilename.mockReturnValue({ docId: 'note-a', isSnapshot: false, device: 'device-a', ts: 1, seq: 1 });
      pullUpdates.mockResolvedValue({ notes: {
        'note-a': {
          updates: [{ key: 'note-a~~device-a~~1~~1.yjs.json', data: btoa(JSON.stringify({
            noteId: 'note-a', device: 'device-a', ts: 1, sequence: 1, update: [1], ...change,
          })) }],
          nextCheckpoint: { deviceId: 'device-a', ts: 1, sequence: 1 },
          hasMore: false,
        },
      } });

      await expect(transport.pull({})).rejects.toMatchObject({ code: 'unlock-required' });
    });

    it('rejects a malformed page checkpoint before returning a cursor delta', async () => {
      const { getRemoteState, pullUpdates } = await import('../../remote-yjs.js');
      getRemoteState.mockResolvedValue({ status: 'initialized', documents: [{ noteId: 'note-a' }] });
      pullUpdates.mockResolvedValue({ notes: {
        'note-a': { updates: [], nextCheckpoint: { deviceId: 'device-a', ts: -1, sequence: 1 }, hasMore: true },
      } });

      await expect(transport.pull({})).rejects.toMatchObject({ code: 'unlock-required' });
    });
  });

  it('sends the complete per-device cursor map instead of one latest checkpoint', async () => {
    const { pullUpdates } = await import('../../remote-yjs.js');
    const { getRemoteState } = await import('../../remote-yjs.js');
    getRemoteState.mockResolvedValue({ status: 'initialized', documents: [{ noteId: 'note-a' }] });
    pullUpdates.mockResolvedValue({ notes: { 'note-a': { updates: [], hasMore: false } } });

    await transport.pull({
      'workspace-1': {
        'note-a': {
          'device-a': { ts: 100, sequence: 1 },
          'device-b': { ts: 50, sequence: 8 },
        },
      },
    });

    expect(pullUpdates).toHaveBeenCalledWith('workspace-1', [{
      noteId: 'note-a',
      checkpoint: {
        'device-a': { ts: 100, sequence: 1 },
        'device-b': { ts: 50, sequence: 8 },
      },
    }]);
  });

  describe('remote push acknowledgements', () => {
    it('advances only the acknowledged sequence and retains failed pending data', async () => {
      const { pushUpdates } = await import('../../remote-yjs.js');
      transport._cloudBuffer.push({ noteId: 'note', update: new Uint8Array([1]) });
      transport._serverProbeComplete = true;
      pushUpdates.mockRejectedValueOnce(new Error('offline'));

      await expect(transport.push({}, { force: true })).rejects.toThrow('offline');
      expect(transport.getCloudBuffer()).toHaveLength(1);

      pushUpdates.mockResolvedValueOnce({
        accepted: 1,
        duplicate: 1,
        checkpoint: { ts: 10, sequence: 4, deviceId: 'mock-device' },
      });
      const result = await transport.push({}, { force: true });
      expect(result.pushed).toBe(2);
      expect(result.cursorsDelta).toEqual({
        'workspace-1': { note: { 'mock-device': { ts: 10, sequence: 4 } } },
      });
    });

    it('keeps checkpoints per note and removes only acknowledged pending updates', async () => {
      const { pushUpdates } = await import('../../remote-yjs.js');
      transport._serverProbeComplete = true;
      transport._cloudBuffer.push(
        { noteId: 'first', update: new Uint8Array([1]) },
        { noteId: 'second', update: new Uint8Array([2]) },
      );
      pushUpdates.mockResolvedValueOnce({
        accepted: 1,
        duplicate: 0,
        checkpoints: { first: { deviceId: 'mock-device', ts: 10, sequence: 1 } },
      });

      const result = await transport.push({}, { force: true });

      expect(result.cursorsDelta).toEqual({
        'workspace-1': { first: { 'mock-device': { ts: 10, sequence: 1 } } },
      });
      expect(transport.getCloudBuffer()).toHaveLength(1);
      expect(transport.getCloudBuffer()[0].noteId).toBe('second');
    });

    it('sends a write queued after acknowledgement on the next cycle', async () => {
      const { pushUpdates } = await import('../../remote-yjs.js');
      transport._serverProbeComplete = true;
      const liveBuffer = transport.getCloudBuffer();
      liveBuffer.push({ noteId: 'note', update: new Uint8Array([1]) });
      pushUpdates
        .mockResolvedValueOnce({ accepted: 1, duplicate: 0, checkpoints: {
          note: { deviceId: 'mock-device', ts: 10, sequence: 1 },
        } })
        .mockResolvedValueOnce({ accepted: 1, duplicate: 0, checkpoints: {
          note: { deviceId: 'mock-device', ts: 11, sequence: 1 },
        } });

      await transport.push({}, { force: true });
      liveBuffer.push({ noteId: 'note', update: new Uint8Array([2]) });
      await transport.push({}, { force: true });

      expect(pushUpdates).toHaveBeenCalledTimes(2);
      expect(pushUpdates.mock.calls[1][1][0].updates[0].data).toBe('encrypted');
    });

    it('returns the new empty push contract', async () => {
      const result = await transport.push({}, { force: true });
      expect(result).toEqual({ updates: [], cursorsDelta: {}, pushed: 0 });
      expect(result).not.toHaveProperty('stored');
      expect(result).not.toHaveProperty('sizeBytes');
    });
  });

  describe('seedOnce/compact', () => {
    it('both are no-ops', async () => {
      await expect(transport.seedOnce()).resolves.not.toThrow();
      await expect(transport.compact()).resolves.not.toThrow();
    });
  });

  describe('normalized pull probe responses', () => {
    const configureStaleCursorProbe = async () => {
      const { readDir, readFile } = await import('@/lib/native/fs');
      const { parseSyncFilename } = await import('../../sync-yjs.js');
      readDir.mockResolvedValue(['note-a~~mock-device~~200~~1.yjs.json']);
      readFile.mockResolvedValue('encrypted-content');
      parseSyncFilename.mockReturnValue({
        docId: 'note-a', isSnapshot: false, device: 'mock-device', ts: 200, seq: 1,
      });
      transport._serverProbeComplete = false;
    };

    it('does not reset a stale cursor when the normalized server probe is populated', async () => {
      await configureStaleCursorProbe();
      const { getRemoteState, pushUpdates } = await import('../../remote-yjs.js');
      getRemoteState.mockResolvedValue({ status: 'initialized', documents: [{ noteId: 'other-note' }] });

      await transport.push({ 'workspace-1': { 'note-a': { 'mock-device': { ts: 200, sequence: 1 } } } }, { force: true });

      expect(pushUpdates).not.toHaveBeenCalled();
      expect(transport._serverProbeComplete).toBe(true);
    });

    it('resets and pushes when the normalized stale-cursor probe is empty', async () => {
      await configureStaleCursorProbe();
      const { getRemoteState, pushUpdates } = await import('../../remote-yjs.js');
      getRemoteState.mockResolvedValue({ status: 'empty', documents: [] });
      pushUpdates.mockResolvedValue({ accepted: 1, duplicate: 0, checkpoints: {} });

      await transport.push({ 'workspace-1': { 'note-a': { 'mock-device': { ts: 200, sequence: 1 } } } }, { force: true });

      expect(pushUpdates).toHaveBeenCalled();
    });

    it('does not seed a populated server with unrelated documents', async () => {
      const { getRemoteState, pushUpdates } = await import('../../remote-yjs.js');
      getRemoteState.mockResolvedValue({ status: 'initialized', documents: [{ noteId: 'other-note' }] });

      await expect(transport.seedCloudOnce()).resolves.toBe(false);

      expect(pushUpdates).not.toHaveBeenCalled();
    });

    it('seeds an authoritative empty server', async () => {
      const { getRemoteState, pushUpdates } = await import('../../remote-yjs.js');
      getRemoteState.mockResolvedValue({ status: 'empty', documents: [] });
      pushUpdates.mockResolvedValue({ accepted: 1, duplicate: 0, checkpoints: {} });

      await transport.seedCloudOnce();

      expect(pushUpdates).toHaveBeenCalled();
    });

    it('serializes concurrent seed attempts through one initialization claim', async () => {
      const { getRemoteState, pushUpdates, claimInitialization, uploadInitializationSnapshot, completeInitialization } = await import('../../remote-yjs.js');
      getRemoteState.mockReset();
      pushUpdates.mockReset();
      claimInitialization.mockReset();
      uploadInitializationSnapshot.mockReset();
      completeInitialization.mockReset();
      getRemoteState.mockResolvedValue({ status: 'empty', documents: [] });
      pushUpdates.mockResolvedValue({ accepted: 1, duplicate: 0, checkpoints: {} });
      let release;
      claimInitialization.mockImplementationOnce(() => new Promise((resolve) => {
        release = () => resolve({ token: 'claim-token' });
      }));
      uploadInitializationSnapshot.mockResolvedValue({ key: 'yjs/workspace-1/meta/1.yjs' });
      completeInitialization.mockResolvedValue({ ok: true });

      const first = transport.seedCloudOnce();
      const second = transport.seedCloudOnce();
      await vi.waitFor(() => expect(release).toBeTypeOf('function'));
      release();
      await Promise.all([first, second]);

      expect(claimInitialization).toHaveBeenCalledTimes(1);
      expect(completeInitialization).toHaveBeenCalledTimes(1);
    });

    it('does not complete initialization after a failed journal upload', async () => {
      const { getRemoteState, pushUpdates, claimInitialization, completeInitialization } = await import('../../remote-yjs.js');
      getRemoteState.mockReset();
      pushUpdates.mockReset();
      claimInitialization.mockReset();
      completeInitialization.mockReset();
      getRemoteState.mockResolvedValue({ status: 'empty', documents: [] });
      claimInitialization.mockResolvedValue({ token: 'claim-token' });
      pushUpdates.mockRejectedValue(new Error('offline during seed'));

      await expect(transport.seedCloudOnce()).resolves.toBe(false);
      expect(completeInitialization).not.toHaveBeenCalled();
    });

    it.each(['initializing', 'initialized', 'recovering'])('does not seed a server in %s state', async (status) => {
      const { getRemoteState, pushUpdates } = await import('../../remote-yjs.js');
      getRemoteState.mockResolvedValue({ status, documents: [] });

      await expect(transport.seedCloudOnce()).resolves.toBe(false);

      expect(pushUpdates).not.toHaveBeenCalled();
    });

    it('keeps the stale probe incomplete after a state query failure', async () => {
      await configureStaleCursorProbe();
      const { getRemoteState, pushUpdates } = await import('../../remote-yjs.js');
      getRemoteState.mockRejectedValue(new Error('offline'));

      await transport.push({ 'workspace-1': { 'note-a': { 'mock-device': { ts: 200, sequence: 1 } } } }, { force: true });

      expect(pushUpdates).not.toHaveBeenCalled();
      expect(transport._serverProbeComplete).toBe(false);
    });

    it.each([
      undefined,
      null,
      {},
      { status: 'unknown', documents: [] },
      { status: 'initialized', documents: 'not-an-array' },
    ])('keeps the stale probe incomplete for malformed state responses: %o', async (state) => {
      await configureStaleCursorProbe();
      const { getRemoteState, pushUpdates } = await import('../../remote-yjs.js');
      getRemoteState.mockResolvedValue(state);

      await expect(transport.push({ 'workspace-1': { 'note-a': { 'mock-device': { ts: 200, sequence: 1 } } } }, { force: true }))
        .rejects.toMatchObject({ code: 'sync-state-invalid' });

      expect(pushUpdates).not.toHaveBeenCalled();
      expect(transport._serverProbeComplete).toBe(false);
    });
  });
});
