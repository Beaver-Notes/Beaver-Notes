import * as Y from 'yjs';
import { deterministicClientId } from '@/lib/yjs/helpers.js';

// Chunked documents (item 7): a note whose content exceeds CHUNK_TRIGGER_BYTES
// is stored as N independent yjs docs (~CHUNK_TARGET_BYTES each) plus a small
// manifest in the note's own slot. Open cost becomes O(visible chunks) instead
// of O(document), snapshot IPC shrinks per chunk, and sync moves per-chunk
// deltas. Slot ids stay within the server's note-id charset
// (/^[a-zA-Z0-9_-]+$/ in Beaver-Sync): note ids are UUIDs (no underscores), so
// the `_c<N>` / `_manifest` suffixes cannot collide with a real note id.

export const CHUNK_SCHEMA_VERSION = 1;
// Seeder generation: bump when the chunk seeding strategy changes in a way
// that old on-disk indexes cannot serve (gen 1 = carve-based — its delete-set
// union merges to an empty document and must never be served; gen 2 =
// deterministic re-seed). planOpenPath refuses indexes with an older gen and
// the idle rebuild rewrites them, so the migration is self-healing.
export const CHUNK_SEEDER_VERSION = 2;
// A note becomes chunked when its serialized content crosses this size OR it
// has enough top-level nodes: CRDT struct overhead means a node-heavy doc can
// carry megabytes of yjs state in modest JSON (measured: 3,001 nodes / 4.7MB
// blob ≈ 120KB JSON), so bytes alone under-fire exactly where open cost lives.
export const CHUNK_TRIGGER_BYTES = 1024 * 1024;
export const CHUNK_MIN_NODES = 600;
// Target size per chunk (~256KB, or ~150 top-level nodes for node-heavy
// docs); boundaries prefer heading cuts.
export const CHUNK_TARGET_BYTES = 256 * 1024;
export const CHUNK_TARGET_NODES = 150;
// A single node larger than the target still forms its own oversized chunk
// rather than being split mid-node; only an unbroken run bigger than these
// hard caps forces a cut between arbitrary nodes.
export const CHUNK_HARD_MAX_BYTES = 512 * 1024;
export const CHUNK_HARD_MAX_NODES = 400;
// Manifest key inside the base note doc's Y.Map.
export const CHUNK_MANIFEST_KEY = 'manifest';

export function chunkSlotId(noteId, index) {
  return `${noteId}_c${index}`;
}

export function manifestSlotId(noteId) {
  return `${noteId}_manifest`;
}

export function isChunkSlot(slotId) {
  return /_c\d+$/.test(String(slotId || ''));
}

export function isManifestSlot(slotId) {
  return String(slotId || '').endsWith('_manifest');
}

// Strip the chunk suffix; returns the input untouched for plain note ids.
export function baseNoteId(slotId) {
  const s = String(slotId || '');
  return s.replace(/_(c\d+|manifest)$/, '');
}

function nodeBytes(nodeJson) {
  try {
    return JSON.stringify(nodeJson).length;
  } catch {
    return 0;
  }
}

function headingLevel(nodeJson) {
  if (nodeJson?.type !== 'heading') return null;
  const level = Number(nodeJson.attrs?.level);
  return Number.isFinite(level) ? level : null;
}

function previewOf(nodeJson) {
  try {
    return JSON.stringify(nodeJson).slice(0, 64);
  } catch {
    return '';
  }
}

/**
 * Split a ProseMirror JSON document ({ content: [nodes] }) into chunk plans.
 * Greedy accumulation with a preference for cutting after level<=2 headings:
 * a heading that pushes the running total past the target ends the chunk, and
 * any node that blows past the hard cap ends it immediately. Oversized single
 * nodes become their own chunk (never split mid-node).
 */
export function planChunks(
  contentJson,
  {
    targetBytes = CHUNK_TARGET_BYTES,
    hardMaxBytes = CHUNK_HARD_MAX_BYTES,
    targetNodes = CHUNK_TARGET_NODES,
    hardMaxNodes = CHUNK_HARD_MAX_NODES,
  } = {},
) {
  const nodes = Array.isArray(contentJson?.content) ? contentJson.content : [];
  const plans = [];
  let current = [];
  let currentBytes = 0;
  let currentStart = 0;

  const flush = () => {
    if (!current.length) return;
    plans.push({
      nodes: current,
      start: currentStart,
      end: currentStart + current.length,
      bytes: currentBytes,
      headPreview: previewOf(current[0]),
    });
    currentStart += current.length;
    current = [];
    currentBytes = 0;
  };

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    const size = nodeBytes(node);
    const level = headingLevel(node);
    const overTarget =
      current.length > 0 && (currentBytes + size > targetBytes || current.length + 1 > targetNodes);
    const boundaryHere = level !== null && level <= 2;
    const hardOverflow =
      current.length > 0 &&
      (currentBytes + size > hardMaxBytes || current.length + 1 > hardMaxNodes);
    // Grace cut: heading-sparse documents must still chunk near the target —
    // waiting for a boundary would bloat chunks up to the hard cap. Past a
    // small margin, cut between arbitrary nodes.
    const graceCut =
      current.length > 0 &&
      (currentBytes > targetBytes * 1.25 || current.length > targetNodes * 1.5);

    if (hardOverflow || graceCut || (overTarget && boundaryHere) || currentBytes > hardMaxBytes || current.length > hardMaxNodes) {
      flush();
    }
    current.push(node);
    currentBytes += size;
    if ((currentBytes >= targetBytes || current.length >= targetNodes) && boundaryHere) {
      // Heading ended right at the target: cut here so the next chunk opens
      // with body content instead of a dangling heading.
      flush();
    }
  }
  flush();
  return plans;
}

// Empirically verified yjs rule: concurrent items tying at the same
// (origin=null, right=null) fragment slot integrate in ASCENDING clientID
// order, independent of application order. Chunk ids therefore ascend with
// the chunk index, making merged-doc order = manifest order deterministically.
export const CHUNK_ID_ROOM = 4096;

export function chunkClientId(noteId, index) {
  const base = deterministicClientId(`${noteId}:chunk-base`);
  const ceiling = 0xffffffff - CHUNK_ID_ROOM;
  const clamped = base % ceiling;
  return ((clamped + index) % 0xffffffff) || 1;
}

/**
 * Seed one chunk doc from a plan. The client id ascends with the chunk index
 * (chunkClientId), so when all chunk states are applied into one merged doc
 * the fragments lay out in manifest order — see chunkClientId. Identical
 * re-seeds converge instead of concatenating (same invariant as
 * seedDeterministically); divergent same-rev re-seeds are prevented upstream
 * by the log-watermark discipline (chunk-store.js).
 */
export async function seedChunkDoc(plan, slotId) {
  const [{ prosemirrorJSONToYXmlFragment }, { ensureSchema }] = await Promise.all([
    import('@tiptap/y-tiptap'),
    import('@/lib/yjs/helpers.js'),
  ]);
  const schema = await ensureSchema();
  const doc = new Y.Doc();
  const base = baseNoteId(slotId);
  const match = /_c(\d+)$/.exec(String(slotId || ''));
  doc.clientID = chunkClientId(base, match ? Number(match[1]) : 0);
  prosemirrorJSONToYXmlFragment(
    schema,
    { type: 'doc', content: plan.nodes },
    doc.getXmlFragment('content'),
  );
  return doc;
}

/** SHA-256 of a chunk's node JSON, hex-encoded. Change detector for the manifest. */
export async function contentHashOf(plan) {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(JSON.stringify(plan.nodes)),
  );
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function buildManifest(plans, noteId, { previous, hashes } = {}) {
  const prevByIndex = new Map((previous?.chunks || []).map((c) => [c.key, c]));
  return {
    version: CHUNK_SCHEMA_VERSION,
    seedGen: CHUNK_SEEDER_VERSION,
    chunks: plans.map((plan, i) => {
      const key = chunkSlotId(noteId, i);
      const prev = prevByIndex.get(key);
      return {
        key,
        size: plan.bytes,
        hash: hashes?.[i] ?? prev?.hash ?? null,
        rev: (prev?.rev || 0) + 1,
      };
    }),
    totalBytes: plans.reduce((sum, p) => sum + p.bytes, 0),
    splitAt: Date.now(),
  };
}

/**
 * Apply chunk snapshot bytes into one merged doc, in manifest order. Chunk
 * client ids ascend with index (chunkClientId), so yjs resolves the
 * equal-origin ties between chunk heads in manifest order regardless of the
 * order updates arrive or are applied in.
 */
export function applyChunksToDoc(targetDoc, chunkStates) {
  // Apply all chunk states to a temporary doc first (no ProseMirror overhead),
  // then encode as a single update and apply to the target doc. This collapses
  // N ProseMirror reconciliations into one — the dominant cost when loading
  // many chunks at once. Chunk client ids ascend with index (chunkClientId),
  // so yjs integrates the merged state in manifest order correctly.
  const tmp = new Y.Doc();
  try {
    for (const state of chunkStates) {
      const bytes = state instanceof Uint8Array ? state : toBytes(state);
      if (!bytes || bytes.length === 0) continue;
      Y.applyUpdate(tmp, bytes, 'load');
    }
    const single = Y.encodeStateAsUpdate(tmp);
    if (single && single.length > 0) {
      // Origin 'load' matches the load-time filter in useNoteYjs's update
      // observer: chunk application must never re-enter the persistence buffer
      // (chunk items are derived copies of base-log content — persisting them
      // would duplicate every block).
      Y.applyUpdate(targetDoc, single, 'load');
    }
  } finally {
    tmp.destroy();
  }
}

function toBytes(state) {
  if (state instanceof Uint8Array) return state;
  if (typeof state === 'string') {
    // base64 (IPC path) — decoded inline to avoid a codec import cycle.
    const bin = atob(state);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  return null;
}

/** True when the doc justifies chunked storage (bytes OR node count). */
export function shouldChunkDoc(doc, { triggerBytes = CHUNK_TRIGGER_BYTES, minNodes = CHUNK_MIN_NODES } = {}) {
  if (!doc) return false;
  const frag = doc.getXmlFragment('content');
  if (frag.length === 0) return false;
  if (frag.length >= minNodes) return true;
  try {
    const json = frag.toJSON();
    return JSON.stringify(json).length > triggerBytes;
  } catch {
    return false;
  }
}
