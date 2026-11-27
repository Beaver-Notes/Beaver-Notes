import { describe, it, expect, vi, beforeAll } from 'vitest';
import * as Y from 'yjs';

// Editor-coverage test (plugin future-proofing): every node type registered
// by the editor's yjs extension set — today's AND any future one — must
// survive the chunked-document pipeline. Content for each schema node type is
// generated generically (no per-type authoring), seeded through the app's
// real yjs conversion path, split, carved, merged (even in reversed
// application order), and compared back through the same converter. A new
// block component that breaks chunking fails here automatically.

vi.mock('@/store/app', () => ({
  useAppStore: () => ({ setting: { collapsibleHeading: false } }),
}));

import { yjsExtensions } from '@/lib/tiptap';
import { getSchema } from '@tiptap/core';
import { normalizeNodeJson } from '../chunk-store.js';
import {
  planChunks,
  applyChunksToDoc,
  chunkClientId,
  chunkSlotId,
} from '../chunking.js';

let schema = null;
let yxml = null;

async function typesOf(doc) {
  const json = yxml.yXmlFragmentToProsemirrorJSON(doc.getXmlFragment('content'));
  return (json.content || []).map((n) => n.type);
}

// Real rebuild pipeline (schema-aware): convert, normalize against the editor
// schema, split, seed chunks with monotonic client ids, and merge.
function pipelinePlans(source) {
  const raw = yxml.yXmlFragmentToProsemirrorJSON(source.getXmlFragment('content'));
  const normalized = (raw.content || [])
    .map((n) => normalizeNodeJson(schema, n))
    .filter(Boolean);
  return { normalized, plans: planChunks({ content: normalized }) };
}

function buildChunks(plans) {
  return plans.map((plan, i) => {
    const chunk = new Y.Doc();
    chunk.clientID = chunkClientId('coverage', i);
    yxml.prosemirrorJSONToYXmlFragment(
      schema,
      { type: 'doc', content: plan.nodes },
      chunk.getXmlFragment('content'),
    );
    return chunk;
  });
}

beforeAll(async () => {
  yxml = await import('@tiptap/y-tiptap');
  schema = getSchema(yjsExtensions);
});

// Generic top-level node generator: fills text-capable types with content,
// creates leaf/composite types empty, and skips types that are not valid at
// the document top level. Future node types are covered automatically. Each
// candidate is validated against the schema's own top node type, so the
// generated document is always schema-valid.
function generateTopLevelNodes() {
  const accepted = [];
  let i = 0;
  for (const name of Object.keys(schema.nodes)) {
    if (name === 'doc' || name === 'text') continue;
    const type = schema.nodes[name];
    try {
      let node;
      if (type.isLeaf) node = type.create();
      else if (name === 'heading') node = type.create({ level: 2 }, [schema.text(`H ${name} ${i}`)]);
      else if (type.inlineContent) node = type.create(null, [schema.text(`body ${name} ${i}`)]);
      else node = type.create();
      schema.topNodeType.create(null, [...accepted, node]);
      accepted.push(node);
      i += 1;
    } catch {
      // Not valid at the top level (or needs required attrs) — skip.
    }
  }
  return accepted;
}

async function seedSourceDoc(pmNodes) {
  const docNode = schema.topNodeType.create(null, pmNodes);
  const doc = new Y.Doc();
  yxml.prosemirrorJSONToYXmlFragment(schema, docNode.toJSON(), doc.getXmlFragment('content'));
  return doc;
}

describe('chunk pipeline covers every editor node type', () => {
  it('round-trips the full extension set through split/seed/merge', async () => {
    const pmNodes = generateTopLevelNodes();
    expect(pmNodes.length).toBeGreaterThan(10); // the real extension set, not a stub

    const source = await seedSourceDoc(pmNodes);
    const sourceTypes = await typesOf(source);

    const { normalized, plans } = pipelinePlans(source);
    expect(normalized.length).toBe(sourceTypes.length); // nothing dropped for known types
    const chunks = buildChunks(plans);
    const merged = new Y.Doc();
    applyChunksToDoc(merged, chunks.map((c) => Y.encodeStateAsUpdate(c)));
    chunks.forEach((c) => c.destroy());

    expect(await typesOf(merged)).toEqual(sourceTypes);
    source.destroy();
    merged.destroy();
  });

  it('preserves order even when chunk states are applied in reverse', async () => {
    const pmNodes = generateTopLevelNodes();
    const source = await seedSourceDoc(pmNodes);
    const sourceTypes = await typesOf(source);
    const { plans } = pipelinePlans(source);
    const chunks = buildChunks(plans);
    const merged = new Y.Doc();
    applyChunksToDoc(merged, chunks.map((c) => Y.encodeStateAsUpdate(c)).reverse());
    expect(await typesOf(merged)).toEqual(sourceTypes);
    chunks.forEach((c) => c.destroy());
    source.destroy();
    merged.destroy();
  });

  it('names chunk slots within the server-safe charset for any note id shape', () => {
    expect(chunkSlotId('abcDEF123-_x', 7)).toMatch(/^[a-zA-Z0-9_-]+$/);
  });
});
