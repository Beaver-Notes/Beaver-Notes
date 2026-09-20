import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';

const { unmountHooks, ensureNoteKeyMock } = vi.hoisted(() => ({
  unmountHooks: [],
  ensureNoteKeyMock: vi.fn(),
}));

vi.mock('vue', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, onUnmounted: (fn) => unmountHooks.push(fn) };
});

vi.mock('@/lib/native/yjs.js', () => ({
  appendUpdate: vi.fn().mockResolvedValue(undefined),
  getUpdates: vi.fn().mockResolvedValue([]),
  getSnapshot: vi.fn().mockResolvedValue(null),
  compactUpdates: vi.fn().mockResolvedValue(undefined),
  compactNote: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/utils/sync/pending-writes.js', () => ({ queueSyncWrite: vi.fn() }));
vi.mock('@/lib/sync/ws-sync.js', () => ({
  getWsSync: () => ({ leaveNoteRoom: vi.fn() }),
  setRoomKey: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/composable/useNoteSharing', () => ({
  useNoteSharing: () => ({
    ensureNoteKey: ensureNoteKeyMock,
  }),
}));
vi.mock('@/store/workspace', () => ({ useWorkspaceStore: () => ({ activeId: 'ws' }) }));
vi.mock('@/utils/speed.js', () => ({ speed: () => ({ end: vi.fn() }) }));
vi.mock('@/lib/yjs/helpers.js', () => ({
  getDeviceId: () => 'device',
  applyUpdatesToDoc: vi.fn(),
  toUint8Array: (d) => d,
  ensureSchema: vi.fn(),
  seedDeterministically: vi.fn(),
}));
vi.mock('@/lib/yjs/shared.js', () => ({
  registerActiveDoc: vi.fn(),
  unregisterActiveDoc: vi.fn(),
  applyRemote: vi.fn(),
}));

import { useNoteYjs, flushAllNoteYjsPending } from '@/composable/useNoteYjs';
import { appendUpdate, getSnapshot } from '@/lib/native/yjs.js';
import { registerActiveDoc } from '@/lib/yjs/shared.js';
import { setRoomKey } from '@/lib/sync/ws-sync.js';

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  vi.clearAllMocks();
  ensureNoteKeyMock.mockResolvedValue('ab'.repeat(32));
  getSnapshot.mockResolvedValue(null);
  appendUpdate.mockResolvedValue(undefined);
});

afterEach(async () => {
  for (const fn of unmountHooks) {
    try {
      await fn();
    } catch {}
  }
  unmountHooks.length = 0;
});

describe('load sequencing', () => {
  it('never installs a load that was superseded while awaiting', async () => {
    let releaseA;
    getSnapshot.mockImplementation((noteId) => {
      if (noteId === 'A') {
        return new Promise((resolve) => {
          releaseA = resolve;
        });
      }
      return Promise.resolve(null);
    });

    const { load, doc } = useNoteYjs();
    const pA = load('A');
    await tick(); // let A reach its pending snapshot read
    const pB = load('B');
    await pB;

    const installed = doc.value;
    expect(installed).toBeTruthy();
    const registered = () => registerActiveDoc.mock.calls.map((c) => c[0]);
    expect(registered()).toContain('B');
    expect(registered()).not.toContain('A');

    releaseA(new Uint8Array(0));
    await pA;

    // A's late completion must not replace B's installed doc.
    expect(doc.value).toBe(installed);
    expect(registered()).not.toContain('A');
  });

  it('resets ready while switching and persists updates under the displayed note', async () => {
    const { load, doc, ready } = useNoteYjs();
    await load('B');
    expect(ready.value).toBe(true);

    doc.value.transact(() => {
      doc.value.getText('title').insert(0, 'x');
    });

    // The flush is debounced; only the lifecycle flush (finding 11) runs here.
    expect(appendUpdate).not.toHaveBeenCalled();
    window.dispatchEvent(new Event('pagehide'));
    await tick();

    expect(appendUpdate).toHaveBeenCalled();
    for (const call of appendUpdate.mock.calls) {
      expect(call[0]).toBe('B');
    }
  });
});

describe('late joiner while the note key is pending (non-blocking, self-healing)', () => {
  let capturedOpts;
  beforeEach(() => {
    capturedOpts = null;
    ensureNoteKeyMock.mockImplementation((noteId, opts) => {
      capturedOpts = opts;
      return Promise.resolve(null);
    });
  });

  it('accepts and persists an edit under the note id instead of dropping it', async () => {
    const { load, doc, pendingSetup } = useNoteYjs();
    await load('late');
    expect(pendingSetup.value).toBe(true);

    doc.value.transact(() => {
      doc.value.getText('title').insert(0, 'kinetic');
    });
    window.dispatchEvent(new Event('pagehide'));
    await tick();

    expect(appendUpdate).toHaveBeenCalledTimes(1);
    expect(appendUpdate.mock.calls[0][0]).toBe('late');
  });

  it('clears pendingSetup and re-keys the room when the key arrives later', async () => {
    const { load, doc, pendingSetup } = useNoteYjs();
    await load('late');
    expect(pendingSetup.value).toBe(true);
    expect(capturedOpts.onKeyResolved).toBeTypeOf('function');

    await capturedOpts.onKeyResolved('cd'.repeat(32));

    expect(pendingSetup.value).toBe(false);
    expect(setRoomKey).toHaveBeenCalledWith('workspace:ws:note:late', 'cd'.repeat(32));

    doc.value.transact(() => {
      doc.value.getText('title').insert(0, 'sealed');
    });
    window.dispatchEvent(new Event('pagehide'));
    await tick();

    expect(appendUpdate).toHaveBeenCalledTimes(1);
    expect(appendUpdate.mock.calls[0][0]).toBe('late');
  });

  it('stays editable and persists when the key never arrives', async () => {
    const { load, doc, pendingSetup } = useNoteYjs();
    await load('late');

    // No onKeyResolved ever fires: the flag stays true but must block nothing.
    doc.value.transact(() => {
      doc.value.getText('title').insert(0, 'still editable');
    });
    window.dispatchEvent(new Event('pagehide'));
    await tick();

    expect(appendUpdate).toHaveBeenCalledTimes(1);
    expect(appendUpdate.mock.calls[0][0]).toBe('late');
    expect(pendingSetup.value).toBe(true);
  });

  it('does not force the page editor read-only while the key is pending', () => {
    const src = fs.readFileSync('src/pages/note/_id.vue', 'utf8');
    expect(src).not.toContain("pendingSetup ? 'viewer' : noteRole");
    expect(src).not.toContain('canEdit(noteRole) && !pendingSetup');
  });
});

describe('pagehide flush (finding 11)', () => {
  it('flushes the debounced delta on pagehide instead of dropping it', async () => {
    const { load, doc } = useNoteYjs();
    await load('B');

    doc.value.transact(() => {
      doc.value.getText('title').insert(0, 'draft');
    });
    expect(appendUpdate).not.toHaveBeenCalled();

    window.dispatchEvent(new Event('pagehide'));
    await tick();

    expect(appendUpdate).toHaveBeenCalledTimes(1);
    expect(appendUpdate.mock.calls[0][0]).toBe('B');
  });
});

describe('failed persist re-queue (finding 12)', () => {
  it('retains the delta after retries fail and surfaces the error', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    let calls = 0;
    appendUpdate.mockImplementation(async () => {
      calls++;
      if (calls <= 3) throw new Error('disk full');
      return undefined;
    });

    const { load, doc } = useNoteYjs();
    await load('B');
    doc.value.transact(() => {
      doc.value.getText('title').insert(0, 'x');
    });

    window.dispatchEvent(new Event('pagehide'));
    await new Promise((resolve) => setTimeout(resolve, 700));

    // 3 attempts in the first flush, then the delta stays buffered.
    expect(appendUpdate).toHaveBeenCalledTimes(3);
    expect(errorSpy).toHaveBeenCalled();

    // A later flush retries the retained delta and persists it.
    window.dispatchEvent(new Event('pagehide'));
    await tick();
    expect(appendUpdate).toHaveBeenCalledTimes(4);

    errorSpy.mockRestore();
  });
});

describe('flushAllNoteYjsPending (L12)', () => {
  it('flushes buffered deltas of a live instance before sign-out teardown', async () => {
    const { load, doc } = useNoteYjs();
    await load('B');

    doc.value.transact(() => {
      doc.value.getText('title').insert(0, 'unsaved');
    });
    expect(appendUpdate).not.toHaveBeenCalled();

    await flushAllNoteYjsPending();

    expect(appendUpdate).toHaveBeenCalledTimes(1);
    expect(appendUpdate.mock.calls[0][0]).toBe('B');
  });
});
