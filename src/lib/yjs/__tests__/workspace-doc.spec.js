import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as Y from 'yjs';

const { docHolder } = vi.hoisted(() => ({ docHolder: { doc: null } }));

vi.mock('@/lib/native/yjs.js', () => ({
  appendUpdate: vi.fn(),
  getSnapshot: vi.fn().mockResolvedValue(null),
  getUpdates: vi.fn().mockResolvedValue([]),
}));
vi.mock('@/utils/sync/pending-writes.js', () => ({ queueSyncWrite: vi.fn() }));
vi.mock('@/lib/yjs/shared.js', () => ({ registerActiveDoc: vi.fn() }));
vi.mock('@/lib/yjs/meta-doc.js', () => ({
  getWorkspaceDoc: () => docHolder.doc,
  META_DOC_ID: 'meta',
  onWorkspaceDocDestroy: vi.fn(),
}));
vi.mock('@/lib/yjs/helpers.js', () => ({
  getDeviceId: () => 'device',
  toUint8Array: (d) => d,
  objToYMap: (obj) => {
    const map = new Y.Map();
    for (const [key, value] of Object.entries(obj)) {
      map.set(
        key,
        value && typeof value === 'object' && !Array.isArray(value)
          ? (() => {
              const nested = new Y.Map();
              for (const [k, v] of Object.entries(value)) nested.set(k, v);
              return nested;
            })()
          : value,
      );
    }
    return map;
  },
}));
vi.mock('@/lib/sync/ws-sync', () => ({
  getWsSync: () => ({ leaveNoteRoom: vi.fn() }),
  setRoomKey: vi.fn(),
  buildMetaRoomName: vi.fn(),
}));
vi.mock('@/store/workspace', () => ({ useWorkspaceStore: () => ({ activeId: 'ws' }) }));
vi.mock('@/lib/api/workspaces', () => ({
  getWorkspaceKey: vi.fn(),
  getCachedWorkspaceKey: vi.fn(() => null),
  recoverWorkspaceKeyHex: vi.fn(),
}));
vi.mock('@/utils/sync/shared-keys', () => ({
  registerSharedSyncKey: vi.fn(),
}));
vi.mock('@/utils/logger', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));
vi.mock('@/utils/crypto/identity', () => ({ loadOrCreateIdentity: vi.fn() }));
vi.mock('@/utils/crypto/note-key', () => ({ unwrapNoteKey: vi.fn() }));

import { syncNoteMeta, ensureMetaRoomKey } from '@/lib/yjs/workspace-doc.js';

function converge(a, b) {
  const ua = Y.encodeStateAsUpdate(a);
  const ub = Y.encodeStateAsUpdate(b);
  Y.applyUpdate(a, ub);
  Y.applyUpdate(b, ua);
}

describe('syncNoteMeta', () => {
  beforeEach(() => {
    docHolder.doc = null;
  });

  it('merges concurrent field edits from two clients instead of clobbering', () => {
    const docA = new Y.Doc();
    const docB = new Y.Doc();

    docHolder.doc = docA;
    syncNoteMeta({ id: 'n1', title: 'Old', labels: [], isBookmarked: false, folderId: 'f1', updatedAt: 1 });
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));

    // A edits the title while B edits labels/bookmark on the same note.
    docHolder.doc = docA;
    syncNoteMeta({ id: 'n1', title: 'New', labels: [], isBookmarked: false, folderId: 'f1', updatedAt: 2 });

    docHolder.doc = docB;
    syncNoteMeta({ id: 'n1', title: 'Old', labels: ['work'], isBookmarked: true, folderId: 'f1', updatedAt: 2 });

    converge(docA, docB);

    for (const doc of [docA, docB]) {
      const note = doc.getMap('notes').get('n1');
      expect(note.get('title')).toBe('New');
      expect(note.get('labels').toArray()).toEqual(['work']);
      expect(note.get('isBookmarked')).toBe(true);
    }
  });

  it('merges concurrent label add/remove per element instead of LWW', () => {
    const docA = new Y.Doc();
    const docB = new Y.Doc();

    docHolder.doc = docA;
    syncNoteMeta({ id: 'n1', title: 't', labels: ['base'], folderId: 'f1', updatedAt: 1 });
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));

    // A adds one label, B adds another, concurrently.
    docHolder.doc = docA;
    syncNoteMeta({ id: 'n1', title: 't', labels: ['base', 'work'], folderId: 'f1', updatedAt: 2 });

    docHolder.doc = docB;
    syncNoteMeta({ id: 'n1', title: 't', labels: ['base', 'home'], folderId: 'f1', updatedAt: 2 });

    converge(docA, docB);

    for (const doc of [docA, docB]) {
      const labels = doc.getMap('notes').get('n1').get('labels');
      expect([...labels.toArray()].sort()).toEqual(['base', 'home', 'work']);
    }
  });
});

describe('ensureMetaRoomKey', () => {
  it('recovers a legacy-only workspace through the shared recovery helper', async () => {
    const { recoverWorkspaceKeyHex } = await import('@/lib/api/workspaces');
    const { registerSharedSyncKey } = await import('@/utils/sync/shared-keys');
    const { setRoomKey } = await import('@/lib/sync/ws-sync');
    const { loadOrCreateIdentity } = await import('@/utils/crypto/identity');

    recoverWorkspaceKeyHex.mockResolvedValue('ab'.repeat(32));
    loadOrCreateIdentity.mockResolvedValue({ privateKeyHex: 'sk' });

    await ensureMetaRoomKey('ws-legacy');

    // The Phase 1 helper owns device-envelope + legacy items-key fallback;
    // the meta room must reuse it instead of unwrapping envelopes itself.
    expect(recoverWorkspaceKeyHex).toHaveBeenCalledWith(
      'ws-legacy',
      expect.objectContaining({ privateKeyHex: 'sk' })
    );
    expect(setRoomKey).toHaveBeenCalled();
    expect(registerSharedSyncKey).toHaveBeenCalledWith('meta', 'ab'.repeat(32));
  });
});
