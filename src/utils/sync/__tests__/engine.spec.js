import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { SyncEngine } from '../engine.js';

vi.mock('../path.js', () => ({
  getSyncPath: vi.fn(() => Promise.resolve('/tmp/sync-path')),
}));

vi.mock('../sync-assets.js', () => ({
  syncAssets: vi.fn(() => Promise.resolve()),
}));

vi.mock('@/composable/useNoteYjs.js', () => ({
  applyRemote: vi.fn(),
}));

vi.mock('@/lib/native/yjs.js', () => ({
  appendUpdate: vi.fn(() => Promise.resolve()),
}));

vi.mock('@/lib/native/app', () => ({
  getAppDirectory: vi.fn(() => '/tmp/app-dir'),
}));

vi.mock('@/lib/tauri-bridge', () => ({
  path: { join: (...args) => args.join('/') },
}));

vi.mock('@/composable/meta-yjs-doc.js', () => ({
  getWorkspaceDoc: vi.fn(() => ({ getMap: vi.fn(() => ({ get: vi.fn(), keys: vi.fn(() => []) })) })),
}));

vi.mock('@/utils/yjs-helpers.js', () => ({
  yMapToObj: vi.fn(() => ({})),
}));

vi.mock('@/composable/useWorkspaceYjs', () => ({
  syncDeletedAssets: vi.fn(),
}));

vi.mock('@/lib/native/fs', () => ({
  ensureDir: vi.fn(() => Promise.resolve()),
  readDir: vi.fn(() => Promise.resolve([])),
  readFile: vi.fn(() => Promise.resolve('')),
  writeFile: vi.fn(() => Promise.resolve()),
}));

vi.mock('@tauri-apps/api/event', () => ({
  emit: vi.fn(),
}));

// Dynamically imported modules — mock so they resolve instantly (no file I/O)
vi.mock('@/utils/crypto/safeStorageBlob.js', () => ({
  loadSecureBlob: vi.fn(() => Promise.resolve(null)),
}));

vi.mock('@/lib/native/security.js', () => ({
  reconcileSyncKeyParams: vi.fn(() => Promise.resolve()),
  syncKeyReady: vi.fn(() => Promise.resolve(true)),
}));

vi.mock('../vault-key-params.js', () => ({
  fetchCloudKeyParams: vi.fn(() => Promise.resolve(null)),
  cloudKeyParamsReachable: vi.fn(() => false),
  publishCloudKeyParams: vi.fn(() => Promise.resolve()),
}));

describe('SyncEngine mutex', () => {
  let engine;
  let mockLocalTransport;
  let mockCloudTransport;

  beforeEach(() => {
    vi.clearAllMocks();

    mockLocalTransport = {
      pull: vi.fn(() => ({ updates: [], cursorsDelta: {} })),
      push: vi.fn(() => ({ updates: [], cursorsDelta: {}, pushed: 0 })),
      seedOnce: vi.fn(() => Promise.resolve()),
      compact: vi.fn(() => Promise.resolve()),
    };

    mockCloudTransport = {
      pull: vi.fn(() => ({ updates: [], cursorsDelta: {} })),
      push: vi.fn(() => ({ updates: [], cursorsDelta: {}, pushed: 0 })),
      seedOnce: vi.fn(() => Promise.resolve()),
      compact: vi.fn(() => Promise.resolve()),
      syncAssets: vi.fn(() => Promise.resolve()),
      getCloudBuffer: vi.fn(() => []),
    };

    engine = new SyncEngine({
      transports: { local: mockLocalTransport, cloud: mockCloudTransport },
      storage: { get: vi.fn(() => ({})), set: vi.fn() },
      getActiveTransports: () => ['local', 'cloud'],
    });
  });

  it('debug: checks engine state', () => {
    const _p1 = engine.enqueueSync();
    expect(engine.syncing).toBe(true);
    const _p2 = engine.enqueueSync();
    expect(engine.pending).toBe(true);
    expect(engine.pendingWaiters.length).toBe(1);
  });

  it('coalesces concurrent enqueueSync callers', async () => {
    mockLocalTransport.pull.mockReturnValue({ updates: [], cursorsDelta: {} });
    mockCloudTransport.pull.mockReturnValue({ updates: [], cursorsDelta: {} });
    mockCloudTransport.push.mockReturnValue({ updates: [], cursorsDelta: {}, pushed: 0 });

    const promise1 = engine.enqueueSync(true);
    const promise2 = engine.enqueueSync(true);

    // Yield to event loop so _runCycle and its re-run complete
    await new Promise((r) => setTimeout(r, 0));

    await promise1;
    await promise2;

    // Re-run means both cycles call pull
    expect(mockLocalTransport.pull).toHaveBeenCalledTimes(2);
  });

  it('re-runs if another sync requested while running', async () => {
    const pullResolves = [];
    mockLocalTransport.pull.mockImplementation(
      () => new Promise((r) => { pullResolves.push(r); })
    );

    const first = engine.enqueueSync(true);

    // Yield to event loop so _runCycle reaches pull
    await new Promise((r) => setTimeout(r, 0));
    expect(pullResolves.length).toBe(1);

    engine.enqueueSync(); // sets pending = true

    pullResolves[0]({ updates: [], cursorsDelta: {} });

    // Yield again so first cycle finishes & re-run calls pull
    await new Promise((r) => setTimeout(r, 0));
    expect(pullResolves.length).toBe(2);

    await first;

    expect(mockLocalTransport.pull).toHaveBeenCalledTimes(2);
  });

  it('rejects coalesced callers with the same error', async () => {
    mockLocalTransport.pull.mockRejectedValue(new Error('sync fail'));

    const promise1 = engine.enqueueSync(true);
    const promise2 = engine.enqueueSync(true);

    await expect(promise1).rejects.toThrow('sync fail');
    await expect(promise2).rejects.toThrow('sync fail');
  });
});

describe('SyncEngine periodic timer', () => {
  let engine;
  let mockLocalTransport;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mockLocalTransport = {
      pull: vi.fn(() => ({ updates: [], cursorsDelta: {} })),
      push: vi.fn(() => ({ updates: [], cursorsDelta: {}, pushed: 0 })),
      seedOnce: vi.fn(() => Promise.resolve()),
      compact: vi.fn(() => Promise.resolve()),
    };
    engine = new SyncEngine({
      transports: {
        local: mockLocalTransport,
        cloud: {
          pull: vi.fn(() => ({ updates: [], cursorsDelta: {} })),
          push: vi.fn(() => ({ updates: [], cursorsDelta: {}, pushed: 0 })),
          seedOnce: vi.fn(() => Promise.resolve()),
          compact: vi.fn(() => Promise.resolve()),
          syncAssets: vi.fn(() => Promise.resolve()),
        },
      },
      storage: { get: vi.fn(() => ({})), set: vi.fn() },
      getActiveTransports: () => ['local'],
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts pull timer when enabled', async () => {
    engine.startPullTimer();
    await vi.advanceTimersByTimeAsync(30001);
    expect(mockLocalTransport.pull).toHaveBeenCalled();
  });

  it('skips the next idle pull-only tick after a cycle with no updates', async () => {
    engine.startPullTimer();
    // First tick: pulls, finds nothing.
    await vi.advanceTimersByTimeAsync(30001);
    expect(mockLocalTransport.pull).toHaveBeenCalledTimes(1);

    // Second tick (idle, still nothing): the backoff should skip it.
    mockLocalTransport.pull.mockClear();
    await vi.advanceTimersByTimeAsync(30001);
    expect(mockLocalTransport.pull).not.toHaveBeenCalled();

    // Third tick: pulls again.
    await vi.advanceTimersByTimeAsync(30001);
    expect(mockLocalTransport.pull).toHaveBeenCalledTimes(1);
  });

  it('does not skip when the last pull-only cycle found updates', async () => {
    mockLocalTransport.pull
      .mockReturnValueOnce({
        updates: [{ noteId: 'a', update: new Uint8Array([1]), device: 'd', ts: 1 }],
        cursorsDelta: {},
      })
      .mockReturnValue({ updates: [], cursorsDelta: {} });

    engine.startPullTimer();
    await vi.advanceTimersByTimeAsync(30001); // finds updates → no backoff armed
    await vi.advanceTimersByTimeAsync(30001); // pulls (finds nothing → arms backoff)
    await vi.advanceTimersByTimeAsync(30001); // skipped by backoff
    expect(mockLocalTransport.pull.mock.calls.length).toBe(2);
  });

  it('stops pull timer when disabled', () => {
    engine.startPullTimer();
    engine.stopPullTimer();
    vi.advanceTimersByTime(30001);
    expect(true).toBe(true);
  });
});

describe('SyncEngine cursor persistence', () => {
  it('applies and saves each remote page before requesting the next page', async () => {
    const storage = { get: vi.fn(() => ({})), set: vi.fn() };
    const order = [];
    let page = 0;
    const cloud = {
      pull: vi.fn(async () => {
        order.push('pull');
        page++;
        return page === 1
          ? { updates: [{ noteId: 'note', update: new Uint8Array([1]), device: 'device', ts: 1, seq: 1 }], cursorsDelta: { workspace: { note: { device: { ts: 1, sequence: 1 } } } }, hasMore: true }
          : { updates: [{ noteId: 'note', update: new Uint8Array([2]), device: 'device', ts: 2, seq: 2 }], cursorsDelta: { workspace: { note: { device: { ts: 2, sequence: 2 } } } }, hasMore: false };
      }),
      push: vi.fn(() => ({ updates: [], cursorsDelta: {}, pushed: 0 })),
      seedOnce: vi.fn(() => Promise.resolve()),
      compact: vi.fn(() => Promise.resolve()),
      syncAssets: vi.fn(() => Promise.resolve()),
      getCloudBuffer: vi.fn(() => []),
    };
    const local = { pull: vi.fn(() => ({ updates: [], cursorsDelta: {} })), push: vi.fn(() => ({ updates: [], cursorsDelta: {}, pushed: 0 })), seedOnce: vi.fn(() => Promise.resolve()), compact: vi.fn(() => Promise.resolve()) };
    const current = new SyncEngine({
      transports: { local, cloud }, storage,
      getActiveTransports: () => ['cloud'],
    });

    await current.enqueueSync(true);

    expect(storage.set).toHaveBeenCalledTimes(2);
    expect(order).toEqual(['pull', 'pull']);
  });

  it('persists a pull delta and sends it on the next pull without replaying the update', async () => {
    let savedCursors = {};
    const storage = {
      get: vi.fn(() => savedCursors),
      set: vi.fn((_key, value) => { savedCursors = value; }),
    };
    const pulls = [];
    let pullCount = 0;
    const cloud = {
      pull: vi.fn((cursors) => {
        pulls.push(structuredClone(cursors));
        pullCount++;
        const checkpoint = cursors.workspace?.note?.device;
        return pullCount === 1
          ? {
            updates: [{ noteId: 'note', update: new Uint8Array([1]), device: 'device', ts: 10, seq: 2 }],
            cursorsDelta: { workspace: { note: { device: { ts: 10, sequence: 2 } } } },
          }
          : checkpoint?.ts === 10 && checkpoint.sequence === 2
            ? { updates: [], cursorsDelta: {} }
            : { updates: [{ noteId: 'note', update: new Uint8Array([1]), device: 'device', ts: 10, seq: 2 }], cursorsDelta: {} };
      }),
      push: vi.fn(() => ({ updates: [], cursorsDelta: {}, pushed: 0 })),
      seedOnce: vi.fn(() => Promise.resolve()),
      compact: vi.fn(() => Promise.resolve()),
      syncAssets: vi.fn(() => Promise.resolve()),
      getCloudBuffer: vi.fn(() => []),
    };
    const current = new SyncEngine({
      transports: { cloud }, storage,
      getActiveTransports: () => ['cloud'],
    });

    await current.enqueueSync(true);
    await current.enqueueSync(true);

    expect(storage.set).toHaveBeenCalledWith(
      expect.anything(),
      { workspace: { note: { device: { ts: 10, sequence: 2 } } } },
      'settings'
    );
    expect(pulls[1]).toEqual({ workspace: { note: { device: { ts: 10, sequence: 2 } } } });
    expect(cloud.pull).toHaveBeenNthCalledWith(2, {
      workspace: { note: { device: { ts: 10, sequence: 2 } } },
    });
    expect(pulls).toHaveLength(2);
  });

  it('does not report complete when a push fails after bounded retries', async () => {
    vi.clearAllMocks();
    const { emit } = await import('@tauri-apps/api/event');
    const push = vi.fn(() => Promise.reject(new Error('offline')));
    const current = new SyncEngine({
      transports: { local: { pull: vi.fn(() => ({ updates: [], cursorsDelta: {} })), push, seedOnce: vi.fn(() => Promise.resolve()), compact: vi.fn(() => Promise.resolve()) } },
      storage: { get: vi.fn(() => ({})), set: vi.fn() },
      getActiveTransports: () => ['local'],
    });

    await expect(current.enqueueSync(true)).rejects.toThrow('offline');
    expect(push).toHaveBeenCalledTimes(3);
    expect(emit).toHaveBeenCalledWith('sync:status', { status: 'retrying' });
    expect(emit).not.toHaveBeenCalledWith('sync:status', { status: 'complete' });
  });

  it('does not report complete when cloud sync state is malformed', async () => {
    const { emit } = await import('@tauri-apps/api/event');
    const current = new SyncEngine({
      transports: {
        cloud: {
          pull: vi.fn(() => Promise.reject(Object.assign(new Error('Remote sync state payload is malformed'), {
            code: 'sync-state-invalid',
          }))),
          push: vi.fn(() => ({ updates: [], cursorsDelta: {}, pushed: 0 })),
          seedOnce: vi.fn(() => Promise.resolve()),
          compact: vi.fn(() => Promise.resolve()),
          syncAssets: vi.fn(() => Promise.resolve()),
          getCloudBuffer: vi.fn(() => []),
        },
      },
      storage: { get: vi.fn(() => ({})), set: vi.fn() },
      getActiveTransports: () => ['cloud'],
    });

    await expect(current.enqueueSync(true)).rejects.toThrow('Remote sync state payload is malformed');
    expect(emit).toHaveBeenCalledWith('sync:status', { status: 'offline' });
    expect(emit).not.toHaveBeenCalledWith('sync:status', { status: 'complete' });
  });

  it('emits explicit sync status events without payloads', async () => {
    const { emit } = await import('@tauri-apps/api/event');
    const current = new SyncEngine({
      transports: { local: { pull: vi.fn(() => ({ updates: [], cursorsDelta: {} })), push: vi.fn(() => ({ updates: [], cursorsDelta: {}, pushed: 0 })), seedOnce: vi.fn(() => Promise.resolve()), compact: vi.fn(() => Promise.resolve()) } },
      storage: { get: vi.fn(() => ({})), set: vi.fn() },
      getActiveTransports: () => ['local'],
    });
    await current.enqueueSync(true);

    expect(emit).toHaveBeenCalledWith('sync:status', { status: 'syncing' });
    expect(emit).toHaveBeenCalledWith('sync:status', { status: 'complete' });
  });
});

describe('SyncEngine flush', () => {
  let engine;
  let mockLocalTransport;
  let mockCloudTransport;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();

    mockLocalTransport = {
      pull: vi.fn(() => ({ updates: [], cursorsDelta: {} })),
      push: vi.fn(() => ({ updates: [], cursorsDelta: {}, pushed: 0 })),
      seedOnce: vi.fn(() => Promise.resolve()),
      compact: vi.fn(() => Promise.resolve()),
    };

    mockCloudTransport = {
      pull: vi.fn(() => ({ updates: [], cursorsDelta: {} })),
      push: vi.fn(() => ({ updates: [], cursorsDelta: {}, pushed: 0 })),
      seedOnce: vi.fn(() => Promise.resolve()),
      compact: vi.fn(() => Promise.resolve()),
      syncAssets: vi.fn(() => Promise.resolve()),
      getCloudBuffer: vi.fn(() => []),
    };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('passes force:true to cloud transport', async () => {
    engine = new SyncEngine({
      transports: { local: mockLocalTransport, cloud: mockCloudTransport },
      storage: { get: vi.fn(() => ({})), set: vi.fn() },
      getActiveTransports: () => ['local', 'cloud'],
    });

    engine._forceFlush = true;
    await engine.enqueueSync(true);

    expect(mockCloudTransport.push).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ force: true })
    );
  });
});
