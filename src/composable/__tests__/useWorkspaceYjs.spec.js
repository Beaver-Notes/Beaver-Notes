import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import * as Y from 'yjs';

vi.mock('@/lib/tauri-bridge', () => ({
  backend: { invoke: vi.fn(), listen: vi.fn() },
  path: { join: (...p) => p.join('/'), dirname: () => '', basename: (p) => p, extname: () => '', parse: () => ({}) },
}));
vi.mock('@/lib/native/yjs.js', () => ({
  appendUpdate: vi.fn(),
  getSnapshot: vi.fn().mockResolvedValue(null),
  getSnapshots: vi.fn(),
  compactUpdates: vi.fn(),
  deleteUpdates: vi.fn(),
}));
vi.mock('@/lib/native/fs', () => ({ readDir: vi.fn() }));
vi.mock('@/utils/sync/sync-repository.js', () => ({
  getCommitsDir: vi.fn().mockResolvedValue(null),
}));
vi.mock('@/utils/sync/sync-yjs.js', () => ({ writeYjsSnapshot: vi.fn() }));
vi.mock('@/utils/sync/crypto.js', () => ({ encryptJSON: vi.fn() }));
vi.mock('@/utils/sync/pending-writes.js', () => ({ queueSyncWrite: vi.fn() }));
vi.mock('@/utils/yjs-helpers.js', () => ({
  getDeviceId: vi.fn(() => 'device'),
  objToYMap: vi.fn(),
  toUint8Array: vi.fn(),
}));
vi.mock('./useHocuspocusSync.js', () => ({
  getHocuspocusSync: () => ({ joinMetaRoom: vi.fn() }),
}));
vi.mock('@/store/workspace', () => ({ useWorkspaceStore: () => ({ activeId: null }) }));

import { observeWorkspace } from '../useWorkspaceYjs.js';
import { getWorkspaceDoc } from '../meta-yjs-doc.js';

describe('observeWorkspace scheduling', () => {
  const callback = vi.fn();

  beforeAll(() => {
    observeWorkspace(callback);
  });

  beforeEach(() => {
    vi.useFakeTimers();
    callback.mockClear();
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it('does not schedule the debounced callback for seed-origin transactions', () => {
    const doc = getWorkspaceDoc();
    doc.transact(() => {
      const yNote = new Y.Map();
      yNote.set('title', 'seeded note');
      doc.getMap('notes').set('seed-note', yNote);
    }, 'seed');

    vi.advanceTimersByTime(1000);

    expect(callback).not.toHaveBeenCalled();
  });

  it('still schedules the callback for local-origin transactions', () => {
    const doc = getWorkspaceDoc();
    doc.transact(() => {
      const yNote = new Y.Map();
      yNote.set('title', 'local note');
      doc.getMap('notes').set('local-note', yNote);
    }, 'local');

    vi.advanceTimersByTime(1000);

    expect(callback).toHaveBeenCalledTimes(1);
    expect([...callback.mock.calls[0][0]]).toContain('local-note');
  });

  it('still schedules the callback when a sync-origin transaction is applied', () => {
    const doc = getWorkspaceDoc();
    doc.transact(() => {
      const yNote = new Y.Map();
      yNote.set('title', 'synced note');
      doc.getMap('notes').set('sync-note', yNote);
    }, 'sync');

    vi.advanceTimersByTime(1000);

    expect(callback).toHaveBeenCalledTimes(1);
  });
});