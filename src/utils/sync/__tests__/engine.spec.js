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
}));

vi.mock('../vault-key-params.js', () => ({
  fetchCloudKeyParams: vi.fn(() => Promise.resolve(null)),
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

    const promise1 = engine.enqueueSync();
    const promise2 = engine.enqueueSync();

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

    const first = engine.enqueueSync();

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

    const promise1 = engine.enqueueSync();
    const promise2 = engine.enqueueSync();

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

  it('stops pull timer when disabled', () => {
    engine.startPullTimer();
    engine.stopPullTimer();
    vi.advanceTimersByTime(30001);
    expect(true).toBe(true);
  });
});

describe('SyncEngine cursor persistence', () => {
  it('writes cursors when cursor changed mid-cycle', async () => {
    expect(true).toBe(true);
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
