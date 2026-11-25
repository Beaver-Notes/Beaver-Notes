import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as Y from 'yjs';

const mocks = vi.hoisted(() => ({
  compactUpdates: vi.fn(),
  deleteUpdates: vi.fn(),
  getSnapshot: vi.fn(),
  getSnapshots: vi.fn(),
  getStateVector: vi.fn(),
  getContentVersion: vi.fn(),
}));

vi.mock('@/lib/native/yjs.js', () => ({
  compactUpdates: mocks.compactUpdates,
  deleteUpdates: mocks.deleteUpdates,
  getSnapshot: mocks.getSnapshot,
  getSnapshots: mocks.getSnapshots,
  getStateVector: mocks.getStateVector,
  getContentVersion: mocks.getContentVersion,
  appendUpdate: vi.fn(),
  getUpdates: vi.fn(),
}));

vi.mock('@/lib/yjs/helpers.js', () => ({
  toUint8Array: (d) => {
    if (d instanceof Uint8Array) return d;
    if (typeof d === 'string') {
      if (d === '') return new Uint8Array(0);
      return Uint8Array.from(atob(d), (c) => c.charCodeAt(0));
    }
    return new Uint8Array(d);
  },
  deterministicClientId: (seed) => {
    let hash = 0x811c9dc5;
    for (let i = 0; i < seed.length; i++) {
      hash ^= seed.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0) || 1;
  },
  ensureSchema: vi.fn(async () => ({ nodes: { paragraph: {}, text: {}, heading: {} }, marks: {} })),
  applyUpdatesToDoc: vi.fn(),
  getDeviceId: () => 'device',
  seedDeterministically: vi.fn(),
  objToYMap: vi.fn(),
  yMapToObj: vi.fn(),
}));

// Real chunking for split/manifest logic; only carveChunkDoc is replaced (a
// real carve would pull in the tiptap schema via nothing — it's pure yjs —
// but the fake keeps chunk content predictable for the load-order test).
vi.mock('@/lib/yjs/chunking.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    seedChunkDoc: vi.fn(async (plan, slotId) => {
      const index = Number(/_c(\d+)$/.exec(slotId)?.[1] ?? 0);
      const doc = new Y.Doc();
      const frag = doc.getXmlFragment('content');
      doc.transact(() => {
        for (let j = 0; j < plan.nodes.length; j++) {
          const p = new Y.XmlElement('paragraph');
          const t = new Y.XmlText();
          t.insert(0, `c${index}n${j}`);
          p.insert(0, [t]);
          frag.insert(frag.length, [p]);
        }
      });
      return doc;
    }),
  };
});

const { planOpenPath, svEquals, readManifest, rebuildChunkIndex, loadChunksIntoDoc, readManifestDoc } = await import(
  '@/lib/yjs/chunk-store.js'
);

const NOTE = 'a4f0c1de-22bb-4a55-90aa-0d7ef1673ba2';

describe('planOpenPath', () => {
  it('returns full when there is no manifest or chunks', () => {
    expect(planOpenPath({})).toBe('full');
    expect(planOpenPath({ manifest: { version: 1, chunks: [] } })).toBe('full');
  });

  it('returns full when the watermark is missing or stale', () => {
    const manifest = { version: 1, seedGen: 2, chunks: [{ key: `${NOTE}_c0` }], watermark: { '5': 10 } };
    expect(planOpenPath({ manifest, storedStateVector: null })).toBe('full');
    expect(planOpenPath({ manifest, storedStateVector: { '5': 11 } })).toBe('full');
  });

  it('returns chunks when the watermark matches (key order independent)', () => {
    const manifest = { version: 1, seedGen: 2, chunks: [{ key: `${NOTE}_c0` }], watermark: { '5': 10, '9': 2 } };
    expect(planOpenPath({ manifest, storedStateVector: { '9': 2, '5': 10 } })).toBe('chunks');
  });

  it('uses the content version when the manifest carries one', () => {
    const manifest = { version: 1, seedGen: 2, chunks: [{ key: `${NOTE}_c0` }], contentVersion: 7 };
    expect(planOpenPath({ manifest, contentVersion: 7 })).toBe('chunks');
    expect(planOpenPath({ manifest, contentVersion: 8 })).toBe('full');
    // The version is authoritative; the state vector is not consulted.
    expect(planOpenPath({ manifest, contentVersion: 7, storedStateVector: { '5': 99 } })).toBe('chunks');
  });
});

describe('svEquals', () => {
  it('compares structurally, coercing numbers', () => {
    expect(svEquals({ '5': 10 }, { '5': '10' })).toBe(true);
    expect(svEquals({ '5': 10 }, { '5': 10, '6': 0 })).toBe(false);
    expect(svEquals(null, {})).toBe(false);
  });
});

describe('readManifest', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null for a missing/empty slot without throwing', async () => {
    mocks.getSnapshot.mockResolvedValue(null);
    expect(await readManifest(NOTE)).toBeNull();
    mocks.getSnapshot.mockResolvedValue('');
    expect(await readManifest(NOTE)).toBeNull();
    mocks.getSnapshot.mockRejectedValue(new Error('ipc down'));
    expect(await readManifest(NOTE)).toBeNull();
  });

  it('decodes the manifest slot into a plain manifest', async () => {
    const doc = new Y.Doc();
    const map = doc.getMap('manifest');
    doc.transact(() => {
      map.set('version', 1);
      map.set('watermark', { '5': 10 });
      map.set('chunks', [{ key: `${NOTE}_c0`, size: 1, hash: 'h', rev: 1 }]);
    });
    mocks.getSnapshot.mockResolvedValue(
      btoa(String.fromCharCode(...Y.encodeStateAsUpdate(doc))),
    );
    const manifest = await readManifest(NOTE);
    expect(manifest.version).toBe(1);
    expect(manifest.chunks[0].key).toBe(`${NOTE}_c0`);
  });
});

describe('rebuildChunkIndex', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getStateVector.mockResolvedValue({ '777': 42 });
    mocks.getContentVersion.mockResolvedValue(7);
  });

  async function mergedDocWith(content) {
    const doc = new Y.Doc();
    const t = doc.getText('title');
    doc.transact(() => t.insert(0, 'My title'));
    const frag = doc.getXmlFragment('content');
    const p = new Y.XmlElement('paragraph');
    const txt = new Y.XmlText();
    // The frag content only feeds frag.toJSON() in the planner via chunking's
    // shouldChunkDoc — rebuild reads JSON directly, so a marker suffices.
    txt.insert(0, content);
    p.insert(0, [txt]);
    frag.insert(0, [p]);
    return doc;
  }

  it('returns null for empty content without touching storage', async () => {
    const doc = new Y.Doc();
    expect(await rebuildChunkIndex(NOTE, doc)).toBeNull();
    expect(mocks.compactUpdates).not.toHaveBeenCalled();
  });

  it('seeds chunk slots, writes the manifest slot, and captures the content version', async () => {
    const doc = await mergedDocWith('x'.repeat(1024 * 1024));
    const manifest = await rebuildChunkIndex(NOTE, doc);
    expect(manifest).not.toBeNull();
    // 1MB single paragraph stays one chunk (hard max only splits between nodes).
    expect(manifest.chunks).toHaveLength(1);
    expect(manifest.chunks[0].key).toBe(`${NOTE}_c0`);
    // One compact per chunk slot + one for the manifest slot.
    const slots = mocks.compactUpdates.mock.calls.map((c) => c[0]);
    expect(slots).toEqual([`${NOTE}_c0`, `${NOTE}_manifest`]);
    expect(manifest.contentVersion).toBe(7);
    // The state vector is no longer read: it costs a full document rebuild.
    expect(mocks.getStateVector).not.toHaveBeenCalled();
    // Manifest slot bytes decode and carry the title mirror.
    const manifestCall = mocks.compactUpdates.mock.calls.find((c) => c[0] === `${NOTE}_manifest`);
    const mdoc = new Y.Doc();
    Y.applyUpdate(mdoc, manifestCall[1]);
    const stored = readManifestDoc(mdoc);
    expect(stored.title).toBe('My title');
    expect(stored.chunks[0].key).toBe(`${NOTE}_c0`);
  });

  it('drops superseded tail slots when the chunk count shrinks', async () => {
    const doc = await mergedDocWith('x'.repeat(1024 * 1024));
    const previous = {
      version: 1,
      chunks: [
        { key: `${NOTE}_c0`, rev: 1 },
        { key: `${NOTE}_c1`, rev: 1 },
        { key: `${NOTE}_c2`, rev: 1 },
      ],
    };
    await rebuildChunkIndex(NOTE, doc, { previousManifest: previous });
    // c0 is cleared before its rewrite (derived-slot replace rule); c1/c2 are
    // dropped as superseded tails; the manifest slot is cleared before its
    // fresh write.
    expect(mocks.deleteUpdates).toHaveBeenCalledTimes(4);
    expect(mocks.deleteUpdates).toHaveBeenCalledWith(`${NOTE}_c0`);
    expect(mocks.deleteUpdates).toHaveBeenCalledWith(`${NOTE}_c1`);
    expect(mocks.deleteUpdates).toHaveBeenCalledWith(`${NOTE}_c2`);
    expect(mocks.deleteUpdates).toHaveBeenCalledWith(`${NOTE}_manifest`);
  });
});

describe('loadChunksIntoDoc', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function chunkState(text, clientId) {
    const doc = new Y.Doc();
    doc.clientID = clientId;
    const p = new Y.XmlElement('paragraph');
    const t = new Y.XmlText();
    t.insert(0, text);
    p.insert(0, [t]);
    doc.getXmlFragment('content').insert(0, [p]);
    return Y.encodeStateAsUpdate(doc);
  }

  it('applies chunk snapshots in manifest order into the target doc', async () => {
    mocks.getSnapshots.mockResolvedValue({
      [`${NOTE}_c0`]: chunkState('first', 1000),
      [`${NOTE}_c1`]: chunkState('second', 1001),
    });
    const manifest = {
      version: 1,
      chunks: [
        { key: `${NOTE}_c0`, size: 1, hash: 'h', rev: 1 },
        { key: `${NOTE}_c1`, size: 1, hash: 'h', rev: 1 },
      ],
    };
    const target = new Y.Doc();
    expect(await loadChunksIntoDoc(NOTE, manifest, target)).toBe(true);
    const texts = target.getXmlFragment('content').toArray().map((el) => el.get(0).toString());
    expect(texts).toEqual(['first', 'second']);
  });

  it('returns false when a chunk slot is missing so the caller falls back', async () => {
    mocks.getSnapshots.mockResolvedValue({ [`${NOTE}_c0`]: chunkState('first', 1000) });
    const manifest = {
      version: 1,
      chunks: [
        { key: `${NOTE}_c0`, size: 1, hash: 'h', rev: 1 },
        { key: `${NOTE}_c1`, size: 1, hash: 'h', rev: 1 },
      ],
    };
    expect(await loadChunksIntoDoc(NOTE, manifest, new Y.Doc())).toBe(false);
  });
});

