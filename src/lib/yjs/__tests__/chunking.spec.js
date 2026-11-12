import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import {
  planChunks,
  buildManifest,
  applyChunksToDoc,
  shouldChunkDoc,
  chunkSlotId,
  manifestSlotId,
  isChunkSlot,
  isManifestSlot,
  baseNoteId,
  chunkClientId,
  CHUNK_MIN_NODES,
  CHUNK_TRIGGER_BYTES,
} from '../chunking.js';

function paragraph(text) {
  return { type: 'paragraph', content: [{ type: 'text', text }] };
}

function heading(text, level) {
  return {
    type: 'heading',
    attrs: { level, textAlign: null },
    content: [{ type: 'text', text }],
  };
}

function bigParagraph(bytes) {
  return paragraph('x'.repeat(bytes));
}

describe('chunk slot ids', () => {
  it('builds server-charset-safe slot ids ([a-zA-Z0-9_-])', () => {
    const id = 'a4f0c1de-22bb-4a55-90aa-0d7ef1673ba2';
    expect(chunkSlotId(id, 3)).toBe(`${id}_c3`);
    expect(manifestSlotId(id)).toBe(`${id}_manifest`);
    for (const slot of [chunkSlotId(id, 3), manifestSlotId(id)]) {
      expect(slot).toMatch(/^[a-zA-Z0-9_-]+$/);
    }
  });

  it('classifies slots and strips back to the base note id', () => {
    const id = 'a4f0c1de-22bb-4a55-90aa-0d7ef1673ba2';
    expect(isChunkSlot(chunkSlotId(id, 0))).toBe(true);
    expect(isChunkSlot(id)).toBe(false);
    expect(isManifestSlot(manifestSlotId(id))).toBe(true);
    expect(isManifestSlot(id)).toBe(false);
    expect(baseNoteId(chunkSlotId(id, 12))).toBe(id);
    expect(baseNoteId(manifestSlotId(id))).toBe(id);
    expect(baseNoteId(id)).toBe(id);
  });
});

describe('planChunks', () => {
  it('returns a single plan for small content', () => {
    const plans = planChunks({ content: [paragraph('hi')] });
    expect(plans).toHaveLength(1);
    expect(plans[0].nodes).toHaveLength(1);
    expect(plans[0].bytes).toBeGreaterThan(0);
  });

  it('cuts after level<=2 headings once the target is crossed', () => {
    const section = (n) => [heading(`Section ${n}`, 2), bigParagraph(100 * 1024)];
    const content = [...section(0), ...section(1), ...section(2), ...section(3)];
    const plans = planChunks({ content }, { targetBytes: 256 * 1024, hardMaxBytes: 512 * 1024 });
    expect(plans.length).toBeGreaterThan(1);
    for (const plan of plans) {
      // Every cut lands after a heading, so every chunk opens with a heading.
      expect(plan.nodes[0].type).toBe('heading');
    }
  });

  it('never splits a single oversized node; it becomes its own chunk', () => {
    const content = [paragraph('intro'), bigParagraph(600 * 1024), paragraph('outro')];
    const plans = planChunks({ content }, { targetBytes: 256 * 1024, hardMaxBytes: 512 * 1024 });
    expect(plans.map((p) => p.nodes.length)).toEqual([1, 1, 1]);
    expect(plans[1].nodes[0].content[0].text.length).toBe(600 * 1024);
  });

  it('forces a cut between arbitrary nodes past the hard cap', () => {
    const content = [bigParagraph(300 * 1024), bigParagraph(300 * 1024)];
    const plans = planChunks({ content }, { targetBytes: 256 * 1024, hardMaxBytes: 512 * 1024 });
    expect(plans).toHaveLength(2);
  });

  it('handles empty and malformed content', () => {
    expect(planChunks({})).toEqual([]);
    expect(planChunks({ content: [] })).toEqual([]);
  });
});

describe('buildManifest', () => {
  it('numbers chunks and bumps revs against the previous manifest', () => {
    // Explicit plans: two tiny paragraphs share one chunk under the default
    // target, so the manifest test supplies its own split.
    const plans = [
      { nodes: [paragraph('a')], bytes: 10, headPreview: 'a' },
      { nodes: [paragraph('b')], bytes: 12, headPreview: 'b' },
    ];
    const id = 'note-1';
    const m1 = buildManifest(plans, id, { hashes: ['h0', 'h1'] });
    expect(m1.version).toBe(1);
    expect(m1.chunks.map((c) => c.key)).toEqual([chunkSlotId(id, 0), chunkSlotId(id, 1)]);
    expect(m1.chunks[0].hash).toBe('h0');
    expect(m1.chunks.every((c) => c.rev === 1)).toBe(true);
    expect(m1.totalBytes).toBe(22);

    // Every rebuild bumps rev (content-addressed checks happen at the caller);
    // hashes flow through from the previous manifest when not re-supplied.
    const m2 = buildManifest(plans, id, { previous: m1 });
    expect(m2.chunks[0].rev).toBe(2);
    expect(m2.chunks[1].hash).toBe('h1');
  });
});

describe('applyChunksToDoc', () => {
  // Mirrors seedChunkDoc's client assignment (chunkClientId): ids ascend with
  // the chunk index, which is what makes merged-doc order deterministic.
  const makeChunkState = (text, noteId, index, nodeCount = 1) => {
    const doc = new Y.Doc();
    doc.clientID = chunkClientId(noteId, index);
    const frag = doc.getXmlFragment('content');
    doc.transact(() => {
      for (let i = 0; i < nodeCount; i++) {
        const p = new Y.XmlElement('paragraph');
        const t = new Y.XmlText();
        t.insert(0, `${text}-${i}`);
        p.insert(0, [t]);
        frag.insert(frag.length, [p]);
      }
    });
    return Y.encodeStateAsUpdate(doc);
  };

  it('lays chunk contents in manifest order even when applied in reverse', () => {
    const id = 'order-note';
    const c0 = makeChunkState('chunk0', id, 0, 2);
    const c1 = makeChunkState('chunk1', id, 1, 2);
    const c2 = makeChunkState('chunk2', id, 2, 1);
    const merged = new Y.Doc();
    // Deliberately not manifest order: integration must not care.
    applyChunksToDoc(merged, [c2, c0, c1]);
    const texts = merged
      .getXmlFragment('content')
      .toArray()
      .map((el) => el.get(0).toString());
    expect(texts).toEqual(['chunk0-0', 'chunk0-1', 'chunk1-0', 'chunk1-1', 'chunk2-0']);
  });

  it('keeps manifest order under hash-derived ids that collide by chance', () => {
    // Adversarial: two notes whose base hashes would put chunk 1's id BELOW
    // chunk 0's without the ascending-offset construction. chunkClientId must
    // always yield ascending ids within one note.
    const seen = new Map();
    for (let n = 0; n < 200; n++) {
      const id = `note-${n}`;
      const a = chunkClientId(id, 0);
      const b = chunkClientId(id, 1);
      expect(b).toBeGreaterThan(a);
      seen.set(a, id);
    }
    // Cross-note ids may repeat the same space; within-note monotonicity is the invariant.
    expect(seen.size).toBeGreaterThan(0);
  });

  it('accepts base64 strings and skips empty states', () => {
    const id = 'b64-note';
    const bytes = makeChunkState('b64', id, 0);
    const b64 = btoa(String.fromCharCode(...bytes));
    const merged = new Y.Doc();
    applyChunksToDoc(merged, [null, b64, new Uint8Array(0)]);
    expect(merged.getXmlFragment('content').length).toBe(1);
    expect(merged.getXmlFragment('content').get(0).get(0).toString()).toBe('b64-0');
  });
});

describe('shouldChunkDoc', () => {
  it('gates on the serialized content size', () => {
    const small = new Y.Doc();
    expect(shouldChunkDoc(small)).toBe(false);

    const big = new Y.Doc();
    const p = new Y.XmlElement('paragraph');
    const t = new Y.XmlText();
    t.insert(0, 'y'.repeat(CHUNK_TRIGGER_BYTES + 10));
    p.insert(0, [t]);
    big.getXmlFragment('content').insert(0, [p]);
    expect(shouldChunkDoc(big)).toBe(true);
    expect(shouldChunkDoc(null)).toBe(false);
  });

  it('fires on node count alone (node-heavy, byte-light docs)', () => {
    // Measured profile: 3,001 top-level nodes whose CRDT state is megabytes
    // but whose JSON is only ~120KB — bytes alone never triggered.
    const many = new Y.Doc();
    const frag = many.getXmlFragment('content');
    many.transact(() => {
      for (let i = 0; i < CHUNK_MIN_NODES; i++) {
        const p = new Y.XmlElement('paragraph');
        const t = new Y.XmlText();
        t.insert(0, `n${i}`);
        p.insert(0, [t]);
        frag.insert(frag.length, [p]);
      }
    });
    expect(shouldChunkDoc(many)).toBe(true);
  });
});
