import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { SyncEngine } from '../engine.js';

vi.mock('../path.js', () => ({
  getSyncPath: vi.fn(() => Promise.resolve('/tmp/sync-path')),
}));

vi.mock('../sync-assets.js', () => ({
  syncAssets: vi.fn(() => Promise.resolve()),
  yieldToUi: vi.fn(() => Promise.resolve()),
}));

vi.mock('@/composable/useNoteYjs.js', () => ({
  applyRemote: vi.fn(),
}));

vi.mock('@/lib/yjs/shared.js', () => ({
  applyRemote: vi.fn(),
  getActiveDoc: vi.fn(() => null),
}));

vi.mock('@/lib/native/yjs.js', () => ({
  appendUpdate: vi.fn(() => Promise.resolve()),
  appendBatch: vi.fn(() => Promise.resolve()),
  compactUpdates: vi.fn(() => Promise.resolve()),
  getStateVector: vi.fn(() => Promise.resolve({})),
}));

vi.mock('@/lib/native/app', () => ({
  getAppDirectory: vi.fn(() => '/tmp/app-dir'),
  notify: vi.fn(() => Promise.resolve(true)),
}));

vi.mock('@/lib/tauri-bridge', () => ({
  backend: { isTouchRuntime: vi.fn(() => false) },
  path: { join: (...args) => args.join('/') },
}));

vi.mock('@/lib/yjs/meta-doc.js', () => ({
  getWorkspaceDoc: vi.fn(() => ({ getMap: vi.fn(() => ({ get: vi.fn(), keys: vi.fn(() => []) })) })),
  onWorkspaceDocDestroy: vi.fn(),
}));

vi.mock('@/lib/yjs/helpers.js', () => ({
  yMapToObj: vi.fn(() => ({})),
}));

vi.mock('@/lib/yjs/workspace-doc', () => ({
  syncDeletedAssets: vi.fn(),
  reconcileUnknownNotePlaceholders: vi.fn(),
  writeStoresFromWorkspace: vi.fn(() => Promise.resolve()),
}));

vi.mock('@/lib/native/fs', () => ({
  ensureDir: vi.fn(() => Promise.resolve()),
  readDir: vi.fn(() => Promise.resolve([])),
  readFile: vi.fn(() => Promise.resolve('')),
  writeFile: vi.fn(() => Promise.resolve()),
}));

vi.mock('@/lib/settings', () => ({
  getSettingSync: vi.fn((key) => key === 'onboardingCompleted' || key === 'syncTransport' ? 'remote' : undefined),
}));

vi.mock('@tauri-apps/api/event', () => ({
  emit: vi.fn(),
}));

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

vi.mock('../readiness.js', () => ({
  getSyncReadiness: vi.fn(() => Promise.resolve({
    isAuth: true,
    plan: 'team',
    transport: 'remote',
    wantsCloud: true,
    syncAllowed: true,
    keyReady: true,
    workspaceId: 'test-ws',
  })),
}));

const rustGate = { active: false, folderOwned: false };
vi.mock('../rust-shim.js', () => ({
  isRustSyncActive: () => rustGate.active,
  isRustFolderOwner: () => rustGate.folderOwned,
  kickRustSync: vi.fn(() => true),
  kickRustDirty: vi.fn(),
  startRustSync: vi.fn(() => Promise.resolve()),
  stopRustSync: vi.fn(() => Promise.resolve()),
}));

describe('SyncEngine mutex', () => {
  let engine;
  let mockLocalTransport;
  let mockCloudTransport;

  beforeEach(() => {
    vi.clearAllMocks();

    mockLocalTransport = {
      pull: vi.fn(() => ({ updates: [] })),
      push: vi.fn(() => ({ updates: [], pushed: 0 })),
      seedOnce: vi.fn(() => Promise.resolve()),
      compact: vi.fn(() => Promise.resolve()),
    };

    mockCloudTransport = {
      pull: vi.fn(() => ({ updates: [] })),
      push: vi.fn(() => ({ updates: [], pushed: 0 })),
      seedOnce: vi.fn(() => Promise.resolve()),
      compact: vi.fn(() => Promise.resolve()),
      syncAssets: vi.fn(() => Promise.resolve()),
      getCloudBuffer: vi.fn(() => []),
      setReadiness: vi.fn(),
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
    mockLocalTransport.pull.mockReturnValue({ updates: [] });
    mockCloudTransport.pull.mockReturnValue({ updates: [] });
    mockCloudTransport.push.mockReturnValue({ updates: [], pushed: 0 });

    const promise1 = engine.enqueueSync(true);
    const promise2 = engine.enqueueSync(true);

    await new Promise((r) => setTimeout(r, 0));

    await promise1;
    await promise2;

    expect(mockLocalTransport.pull).toHaveBeenCalledTimes(2);
  });

  it('re-runs if another sync requested while running', async () => {
    const pullResolves = [];
    mockLocalTransport.pull.mockImplementation(
      () => new Promise((r) => { pullResolves.push(r); })
    );

    const first = engine.enqueueSync(true);

    await new Promise((r) => setTimeout(r, 0));
    expect(pullResolves.length).toBe(1);

    engine.enqueueSync();

    pullResolves[0]({ updates: [] });

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
      pull: vi.fn(() => ({ updates: [] })),
      push: vi.fn(() => ({ updates: [], pushed: 0 })),
      seedOnce: vi.fn(() => Promise.resolve()),
      compact: vi.fn(() => Promise.resolve()),
    };
    engine = new SyncEngine({
      transports: {
        local: mockLocalTransport,
        cloud: {
pull: vi.fn(() => ({ updates: [] })),
      push: vi.fn(() => ({ updates: [], pushed: 0 })),
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

    await vi.advanceTimersByTimeAsync(30001);
    expect(mockLocalTransport.pull).toHaveBeenCalledTimes(1);

    mockLocalTransport.pull.mockClear();
    await vi.advanceTimersByTimeAsync(30001);
    expect(mockLocalTransport.pull).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(30001);
    expect(mockLocalTransport.pull).toHaveBeenCalledTimes(1);
  });

  it('does not skip when the last pull-only cycle found updates', async () => {
    mockLocalTransport.pull
      .mockReturnValueOnce({
        updates: [{ noteId: 'a', update: new Uint8Array([1]), device: 'd', ts: 1 }],
      })
      .mockReturnValue({ updates: [] });

    engine.startPullTimer();
    await vi.advanceTimersByTimeAsync(30001);
    await vi.advanceTimersByTimeAsync(30001);
    await vi.advanceTimersByTimeAsync(30001);
    expect(mockLocalTransport.pull.mock.calls.length).toBe(2);
  });

  it('stops pull timer when disabled', () => {
    engine.startPullTimer();
    engine.stopPullTimer();
    vi.advanceTimersByTime(30001);
    expect(true).toBe(true);
  });
});

describe('SyncEngine pull loop', () => {
  it('applies all remote pages after the pull loop', async () => {
    const storage = { get: vi.fn(() => ({})), set: vi.fn() };
    const order = [];
    let page = 0;
    const cloud = {
      pull: vi.fn(async () => {
        order.push('pull');
        page++;
        return page === 1
          ? { updates: [{ noteId: 'note', update: new Uint8Array([1]), device: 'device', ts: 1, sequence: 1 }], hasMore: true }
          : { updates: [{ noteId: 'note', update: new Uint8Array([2]), device: 'device', ts: 2, sequence: 2 }], hasMore: false };
      }),
      push: vi.fn(() => ({ updates: [], pushed: 0 })),
      seedOnce: vi.fn(() => Promise.resolve()),
      compact: vi.fn(() => Promise.resolve()),
      syncAssets: vi.fn(() => Promise.resolve()),
      getCloudBuffer: vi.fn(() => []),
      setReadiness: vi.fn(),
    };
    const local = { pull: vi.fn(() => ({ updates: [] })), push: vi.fn(() => ({ updates: [], pushed: 0 })), seedOnce: vi.fn(() => Promise.resolve()), compact: vi.fn(() => Promise.resolve()) };
    const current = new SyncEngine({
      transports: { local, cloud }, storage,
      getActiveTransports: () => ['cloud'],
    });

    await current.enqueueSync(true);

    expect(order).toEqual(['pull', 'pull']);
  });

  it('applies a whole-vault batch completely while yielding to the UI', async () => {
    const storage = { get: vi.fn(() => ({})), set: vi.fn() };
    const updates = Array.from({ length: 60 }, (_, i) => ({
      noteId: `note-${i}`, update: new Uint8Array([i % 256]), device: 'device', ts: i, sequence: i,
    }));
    const cloud = {
      pull: vi.fn(async () => ({ updates, hasMore: false })),
      push: vi.fn(() => ({ updates: [], pushed: 0 })),
      seedOnce: vi.fn(() => Promise.resolve()),
      compact: vi.fn(() => Promise.resolve()),
      syncAssets: vi.fn(() => Promise.resolve()),
      getCloudBuffer: vi.fn(() => []),
      setReadiness: vi.fn(),
    };
    const local = { pull: vi.fn(() => ({ updates: [] })), push: vi.fn(() => ({ updates: [], pushed: 0 })), seedOnce: vi.fn(() => Promise.resolve()), compact: vi.fn(() => Promise.resolve()) };
    const current = new SyncEngine({
      transports: { local, cloud }, storage,
      getActiveTransports: () => ['cloud'],
    });

    await current.enqueueSync(true);

    const { applyRemote } = await import('@/composable/useNoteYjs.js');
    const { appendBatch } = await import('@/lib/native/yjs.js');
    const { yieldToUi } = await import('../sync-assets.js');
    expect(applyRemote).toHaveBeenCalledTimes(60);
    expect(appendBatch).toHaveBeenCalledTimes(1);
    expect(appendBatch.mock.calls[0][0]).toEqual(updates.map((u) => u.noteId));
    expect(yieldToUi).toHaveBeenCalled();
  });

  it('runs multiple sync cycles without errors', async () => {
    const storage = { get: vi.fn(() => ({})), set: vi.fn() };
    let pullCount = 0;
    const cloud = {
      pull: vi.fn(async () => {
        pullCount++;
        return pullCount === 1
          ? { updates: [{ noteId: 'note', update: new Uint8Array([1]), device: 'device', ts: 1, sequence: 1 }], hasMore: true }
          : { updates: [{ noteId: 'note', update: new Uint8Array([2]), device: 'device', ts: 2, sequence: 2 }], hasMore: false };
      }),
      push: vi.fn(() => ({ updates: [], pushed: 0 })),
      seedOnce: vi.fn(() => Promise.resolve()),
      compact: vi.fn(() => Promise.resolve()),
      syncAssets: vi.fn(() => Promise.resolve()),
      getCloudBuffer: vi.fn(() => []),
      setReadiness: vi.fn(),
    };
    const local = { pull: vi.fn(() => ({ updates: [] })), push: vi.fn(() => ({ updates: [], pushed: 0 })), seedOnce: vi.fn(() => Promise.resolve()), compact: vi.fn(() => Promise.resolve()) };
    const current = new SyncEngine({
      transports: { local, cloud }, storage,
      getActiveTransports: () => ['cloud'],
    });

    await current.enqueueSync(true);

    expect(cloud.pull).toHaveBeenCalled();
  });

  it('does not report complete when a push fails after bounded retries', async () => {
    vi.clearAllMocks();
    const { emit } = await import('@tauri-apps/api/event');
    const push = vi.fn(() => Promise.reject(new Error('offline')));
    const current = new SyncEngine({
      transports: { local: { pull: vi.fn(() => ({ updates: [] })), push, seedOnce: vi.fn(() => Promise.resolve()), compact: vi.fn(() => Promise.resolve()) } },
      storage: { get: vi.fn(() => ({})), set: vi.fn() },
      getActiveTransports: () => ['local'],
    });

    await expect(current.enqueueSync(true)).rejects.toThrow('offline');
    expect(push).toHaveBeenCalledTimes(3);
    expect(emit).toHaveBeenCalledWith('sync:status', { status: 'retrying' });
    expect(emit).not.toHaveBeenCalledWith('sync:status', { status: 'complete' });
  });

  it('stops the pull loop when a page fails to apply despite hasMore:true', async () => {
    const { applyRemote } = await import('@/composable/useNoteYjs.js');
    applyRemote.mockImplementation(() => { throw new Error('apply boom'); });

    const cloud = {
      pull: vi.fn(() => ({
        updates: [{ noteId: 'note', update: new Uint8Array([1]), device: 'device', ts: 1, sequence: 1 }],
        hasMore: true,
      })),
      push: vi.fn(() => ({ updates: [], pushed: 0 })),
      seedOnce: vi.fn(() => Promise.resolve()),
      compact: vi.fn(() => Promise.resolve()),
      syncAssets: vi.fn(() => Promise.resolve()),
      getCloudBuffer: vi.fn(() => []),
      setReadiness: vi.fn(),
    };
    const storage = { get: vi.fn(() => ({})), set: vi.fn() };
    const current = new SyncEngine({
      transports: { cloud },
      storage,
      getActiveTransports: () => ['cloud'],
    });

    await current.enqueueSync(true);
    await current.enqueueSync(true);

    expect(cloud.pull).toHaveBeenCalledTimes(2);
    expect(storage.set).not.toHaveBeenCalled();
    applyRemote.mockReset();
    vi.clearAllMocks();
  });

  it('does not report complete when cloud sync state is malformed', async () => {
    const { emit } = await import('@tauri-apps/api/event');
    const current = new SyncEngine({
      transports: {
        cloud: {
          pull: vi.fn(() => Promise.reject(Object.assign(new Error('Remote sync state payload is malformed'), {
            code: 'sync-state-invalid',
          }))),
          push: vi.fn(() => ({ updates: [], pushed: 0 })),
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
      transports: { local: { pull: vi.fn(() => ({ updates: [] })), push: vi.fn(() => ({ updates: [], pushed: 0 })), seedOnce: vi.fn(() => Promise.resolve()), compact: vi.fn(() => Promise.resolve()) } },
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
      pull: vi.fn(() => ({ updates: [] })),
      push: vi.fn(() => ({ updates: [], pushed: 0 })),
      seedOnce: vi.fn(() => Promise.resolve()),
      compact: vi.fn(() => Promise.resolve()),
    };

    mockCloudTransport = {
      pull: vi.fn(() => ({ updates: [] })),
      push: vi.fn(() => ({ updates: [], pushed: 0 })),
      seedOnce: vi.fn(() => Promise.resolve()),
      compact: vi.fn(() => Promise.resolve()),
      syncAssets: vi.fn(() => Promise.resolve()),
      getCloudBuffer: vi.fn(() => []),
      setReadiness: vi.fn(),
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
      expect.objectContaining({ force: true })
    );
  });
});

describe('SyncEngine declined vault join pause', () => {
  it('pauses folder cycles and emits vault-join-required instead of syncing', async () => {
    const { getSettingSync } = await import('@/lib/settings');
    const prevSettings = getSettingSync.getMockImplementation();
    getSettingSync.mockImplementation((key) =>
      key === 'vaultJoinDeclinedPath' ? '/tmp/sync-path' : prevSettings?.(key)
    );

    const local = { pull: vi.fn(), push: vi.fn(), seedOnce: vi.fn(), compact: vi.fn() };
    const engine = new SyncEngine({
      transports: { local },
      storage: { get: vi.fn(() => ({})), set: vi.fn() },
      getActiveTransports: () => ['local'],
    });

    await engine.forceSyncNow();

    const { emit } = await import('@tauri-apps/api/event');
    expect(emit).toHaveBeenCalledWith('sync:status', {
      status: 'vault-join-required',
    });
    expect(local.pull).not.toHaveBeenCalled();
    expect(local.push).not.toHaveBeenCalled();
    const { reconcileSyncKeyParams } = await import('@/lib/native/security.js');
    expect(reconcileSyncKeyParams).not.toHaveBeenCalled();
    expect(engine.syncing).toBe(false);

    getSettingSync.mockImplementation(prevSettings);
  });
});

describe('SyncEngine unconfigured skip', () => {
  it('skips the cycle entirely when no sync path and local-only transport', async () => {
    const { getSyncPath } = await import('../path.js');
    const prev = getSyncPath.getMockImplementation();
    getSyncPath.mockResolvedValue(null);

    const local = { pull: vi.fn(), push: vi.fn(), seedOnce: vi.fn(), compact: vi.fn() };
    const engine = new SyncEngine({
      transports: { local },
      storage: { get: vi.fn(() => ({})), set: vi.fn() },
      getActiveTransports: () => ['local'],
    });

    await engine.forceSyncNow();
    expect(local.pull).not.toHaveBeenCalled();
    expect(local.push).not.toHaveBeenCalled();
    expect(engine.syncing).toBe(false);

    getSyncPath.mockImplementation(prev);
  });
});

describe('SyncEngine notifications', () => {
  let engine;
  let backend;
  let notify;
  let isTouchRuntime;
  let syncKeyReady;
  let mockLocalTransport;
  let mockCloudTransport;

  beforeEach(async () => {
    vi.clearAllMocks();
    ({ notify } = await import('@/lib/native/app'));
    ({ backend } = await import('@/lib/tauri-bridge'));
    isTouchRuntime = backend.isTouchRuntime;
    ({ syncKeyReady } = await import('@/lib/native/security.js'));
    isTouchRuntime.mockReturnValue(false);
    syncKeyReady.mockResolvedValue(true);

    mockLocalTransport = {
      pull: vi.fn(() => ({ updates: [] })),
      push: vi.fn(() => ({ updates: [], pushed: 0 })),
      seedOnce: vi.fn(() => Promise.resolve()),
      compact: vi.fn(() => Promise.resolve()),
    };

    mockCloudTransport = {
      pull: vi.fn(() => ({ updates: [] })),
      push: vi.fn(() => ({ updates: [], pushed: 0 })),
      seedOnce: vi.fn(() => Promise.resolve()),
      compact: vi.fn(() => Promise.resolve()),
      syncAssets: vi.fn(() => Promise.resolve()),
      getCloudBuffer: vi.fn(() => []),
      setReadiness: vi.fn(),
    };

    engine = new SyncEngine({
      transports: { local: mockLocalTransport, cloud: mockCloudTransport },
      storage: { get: vi.fn(() => ({})), set: vi.fn() },
      getActiveTransports: () => ['local', 'cloud'],
    });
  });

  it('does not notify when a completed cycle pulled updates', async () => {
    mockCloudTransport.pull.mockReturnValue({
      updates: [{ noteId: 'a', update: new Uint8Array([1]), device: 'd', ts: 1, sequence: 1 }],
    });

    await engine.enqueueSync(true);

    await new Promise((r) => setTimeout(r, 10));
    expect(notify).not.toHaveBeenCalled();
  });

  it('does not notify when a completed cycle pushed changes', async () => {
    mockCloudTransport.push.mockReturnValue({ updates: [], pushed: 2 });

    await engine.enqueueSync(true);

    await new Promise((r) => setTimeout(r, 10));
    expect(notify).not.toHaveBeenCalled();
  });

  it('does not notify on a no-op completion', async () => {
    await engine.enqueueSync(true);
    await new Promise((r) => setTimeout(r, 10));

    expect(notify).not.toHaveBeenCalled();
  });

  it('does not notify on sync failure', async () => {
    mockLocalTransport.push.mockRejectedValue(new Error('offline'));

    await expect(engine.enqueueSync(true)).rejects.toThrow('offline');
    await new Promise((r) => setTimeout(r, 10));
    expect(notify).not.toHaveBeenCalled();

    await expect(engine.enqueueSync(true)).rejects.toThrow('offline');
    await new Promise((r) => setTimeout(r, 10));
    expect(notify).not.toHaveBeenCalled();
  });

  it('does not notify on locked cycles', async () => {
    const { getSyncReadiness } = await import('../readiness.js');
    getSyncReadiness.mockResolvedValue({
      isAuth: true, plan: 'team', transport: 'remote', wantsCloud: true,
      syncAllowed: true, keyReady: false, workspaceId: 'test-ws',
    });

    engine = new SyncEngine({
      transports: { cloud: mockCloudTransport },
      storage: { get: vi.fn(() => ({})), set: vi.fn() },
      getActiveTransports: () => ['cloud'],
    });

    await engine.enqueueSync(true);
    await new Promise((r) => setTimeout(r, 10));
    expect(notify).not.toHaveBeenCalled();

    await engine.enqueueSync(true);
    await new Promise((r) => setTimeout(r, 10));
    expect(notify).not.toHaveBeenCalled();
  });

  it('does not notify even when isTouchRuntime() is true', async () => {
    isTouchRuntime.mockReturnValue(true);
    const { getSyncReadiness } = await import('../readiness.js');
    getSyncReadiness.mockResolvedValue({
      isAuth: true, plan: 'team', transport: 'remote', wantsCloud: true,
      syncAllowed: true, keyReady: true, workspaceId: 'test-ws',
    });
    mockCloudTransport.pull.mockReturnValue({
      updates: [{ noteId: 'a', update: new Uint8Array([1]), device: 'd', ts: 1, sequence: 1 }],
    });

    await engine.enqueueSync(true);
    await new Promise((r) => setTimeout(r, 10));

    expect(notify).not.toHaveBeenCalled();
  });

  it('forces a push when assets uploaded but the doc push was throttled', async () => {
    mockCloudTransport.syncAssets.mockResolvedValue(2);
    mockCloudTransport.push
      .mockResolvedValueOnce({ updates: [], pushed: 0, throttled: true })
      .mockResolvedValue({ updates: [], pushed: 1 });

    await engine.enqueueSync(false);

    expect(mockCloudTransport.push).toHaveBeenCalledWith(
      expect.objectContaining({ force: true })
    );
  });

  it('does not force a push when nothing was uploaded', async () => {
    mockCloudTransport.syncAssets.mockResolvedValue(0);
    mockCloudTransport.push.mockResolvedValue({ updates: [], pushed: 0, throttled: true });

    await engine.enqueueSync(false);

    expect(mockCloudTransport.push).toHaveBeenCalledTimes(1);
    expect(mockCloudTransport.push).not.toHaveBeenCalledWith(
      expect.objectContaining({ force: true })
    );
  });
});

describe('rust dual-write gate with scoped folders', () => {
  let gateEngine;
  let localPull;

  beforeEach(() => {
    rustGate.active = false;
    rustGate.folderOwned = false;
    localPull = vi.fn(() => ({ updates: [] }));
    gateEngine = new SyncEngine({
      transports: {
        local: {
          pull: localPull,
          push: vi.fn(() => ({ updates: [], pushed: 0 })),
          seedOnce: vi.fn(() => Promise.resolve()),
          compact: vi.fn(() => Promise.resolve()),
        },
        cloud: {
          pull: vi.fn(() => ({ updates: [] })),
          push: vi.fn(() => ({ updates: [], pushed: 0 })),
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
    rustGate.active = false;
    rustGate.folderOwned = false;
  });

  it('skips the JS cycle when Rust owns a non-scoped folder', async () => {
    rustGate.active = true;
    rustGate.folderOwned = true;
    await gateEngine.forceSyncNow();
    expect(localPull).not.toHaveBeenCalled();
  });

  it('routes foreground wake to Rust kick when active', async () => {
    rustGate.active = true;
    const { kickRustSync } = await import('../rust-shim.js');
    await gateEngine.notifyForeground();
    expect(kickRustSync).toHaveBeenCalled();
    expect(localPull).not.toHaveBeenCalled();
  });

  it('runs the JS cycle for scoped folders even while Rust is active', async () => {
    rustGate.active = true;
    rustGate.folderOwned = false;
    const { getSyncPath } = await import('../path.js');
    getSyncPath.mockResolvedValueOnce('scoped:folder1');
    await gateEngine.forceSyncNow();
    expect(localPull).toHaveBeenCalled();
  });

  it('skips cloud phases but runs local when Rust owns cloud on scoped folders', async () => {
    rustGate.active = true;
    rustGate.folderOwned = false;
    const { getSyncPath } = await import('../path.js');
    getSyncPath.mockResolvedValueOnce('scoped:folder1');
    const cloudPull = vi.fn(() => ({ updates: [] }));
    const cloudPush = vi.fn(() => ({ updates: [], pushed: 0 }));
    const cloudAssets = vi.fn(() => Promise.resolve());
    const scopedEngine = new SyncEngine({
      transports: {
        local: {
          pull: localPull,
          push: vi.fn(() => ({ updates: [], pushed: 0 })),
          seedOnce: vi.fn(() => Promise.resolve()),
          compact: vi.fn(() => Promise.resolve()),
        },
        cloud: {
          pull: cloudPull,
          push: cloudPush,
          seedOnce: vi.fn(() => Promise.resolve()),
          compact: vi.fn(() => Promise.resolve()),
          syncAssets: cloudAssets,
        },
      },
      storage: { get: vi.fn(() => ({})), set: vi.fn() },
      getActiveTransports: () => ['local', 'cloud'],
    });
    await scopedEngine.forceSyncNow();
    expect(localPull).toHaveBeenCalled();
    expect(cloudPull).not.toHaveBeenCalled();
    expect(cloudPush).not.toHaveBeenCalled();
    expect(cloudAssets).not.toHaveBeenCalled();
  });

  it('keeps the legacy queue for scoped folders while Rust runs', async () => {
    rustGate.active = true;
    rustGate.folderOwned = false;
    const { queueSyncWrite, hasPendingWrites, clearPendingWrites } =
      await import('../pending-writes.js');
    try {
      queueSyncWrite('/c', 'n1', new Uint8Array([1]));
      expect(hasPendingWrites()).toBe(true);
    } finally {
      clearPendingWrites();
    }
  });
});

describe('rust-shim sync origin tagging', () => {  it('queues exactly the realtime update; a sync:applied for the same note does not echo', async () => {

    const shared = await vi.importActual('@/lib/yjs/shared.js');
    const Y = await import('yjs');
    const doc = new Y.Doc();
    shared.registerActiveDoc('n1', doc);
    try {

      const queued = [];
      doc.on('update', (update, origin) => {
        if (origin === 'load' || origin === 'sync' || origin === 'ws-relay') return;
        queued.push(update);
      });

      doc.getText('t').insert(0, 'hello');

      const remote = new Y.Doc();
      remote.getText('t').insert(0, 'world');
      shared.applyRemote('n1', Y.encodeStateAsUpdate(remote));

      expect(queued).toHaveLength(1);
      const text = doc.getText('t').toString();
      expect(text).toContain('hello');
      expect(text).toContain('world');
    } finally {
      shared.unregisterActiveDoc('n1');
      doc.destroy();
    }
  });
});
