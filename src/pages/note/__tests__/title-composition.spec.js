import { describe, it, expect, vi } from 'vitest';

// Mocks same as Task 1 so useNoteYjs can be imported
vi.mock('@/lib/native/yjs.js', () => ({
  getUpdates: vi.fn().mockResolvedValue([]),
  getSnapshot: vi.fn().mockResolvedValue(null),
  appendUpdate: vi.fn().mockResolvedValue(),
  compactUpdates: vi.fn().mockResolvedValue(),
}));
vi.mock('@/lib/yjs/helpers.js', async () => {
  const Y = await import('yjs');
  return {
    getDeviceId: () => 'd1',
    applyUpdatesToDoc: () => {},
    toUint8Array: (x) => x,
    ensureSchema: vi.fn(),
    // Same FNV-1a contract as the real helper: applyTitleDelta only takes the
    // deterministic seed path while this id is still unused in the doc.
    deterministicClientId: (seed) => {
      let hash = 0x811c9dc5;
      for (let i = 0; i < seed.length; i++) {
        hash ^= seed.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193);
      }
      hash >>>= 0;
      return hash === 0 ? 1 : hash;
    },
    // applyTitleDelta seeds an empty Y.Text through this helper.
    seedDeterministically: (ydoc, seedKey, build, origin) => {
      const temp = new Y.Doc();
      build(temp);
      Y.applyUpdate(ydoc, Y.encodeStateAsUpdate(temp), origin);
      temp.destroy();
    },
  };
});
vi.mock('@/store/workspace', () => ({ useWorkspaceStore: () => ({ activeId: 'w1' }) }));
vi.mock('@/composable/useNoteSharing.js', () => ({
  useNoteSharing: () => ({ ensureNoteKey: vi.fn().mockResolvedValue(null) }),
}));
vi.mock('@/lib/sync/ws-sync.js', () => ({
  getWsSync: () => ({ leaveNoteRoom: () => {} }),
  setRoomKey: vi.fn().mockResolvedValue(),
}));
vi.mock('@/lib/yjs/shared.js', () => ({
  registerActiveDoc: vi.fn(),
  unregisterActiveDoc: vi.fn(),
}));

import { useNoteYjs } from '@/composable/useNoteYjs.js';

describe('title composition guard', () => {
  it('does not seed the store title into the Y.Text on load', async () => {
    const { load, getTitle, setTitle } = useNoteYjs();
    await load('n1', null);
    expect(getTitle()).toBe('');
    setTitle('hello');
    expect(getTitle()).toBe('hello');
  });
});