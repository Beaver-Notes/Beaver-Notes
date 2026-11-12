import * as Y from 'yjs';
import {
  compactUpdates,
  deleteUpdates,
  getContentVersion,
  getSnapshot,
  getSnapshots,
} from '@/lib/native/yjs.js';
import { toUint8Array, ensureSchema } from '@/lib/yjs/helpers.js';
import {
  applyChunksToDoc,
  buildManifest,
  CHUNK_MIN_NODES,
  CHUNK_TRIGGER_BYTES,
  chunkSlotId,
  contentHashOf,
  manifestSlotId,
  CHUNK_SEEDER_VERSION,
  planChunks,
  seedChunkDoc,
} from '@/lib/yjs/chunking.js';

// Chunk index storage (item 7, v1). The base note slot stays the durable
// source of truth — title + content update log, synced exactly as before,
// untouched semantics for sync/history/undo. Chunk slots (`<noteId>_c<N>`) and
// the manifest slot (`<noteId>_manifest`) are a derived, LOCAL-ONLY
// acceleration index (they never appear in the note table, so the Rust push
// scheduler — which enumerates note_content — never syncs them):
//
//   fast open — read the tiny manifest slot; when its watermark (the note's
//               stored state vector captured at rebuild time) equals the
//               current stored state vector, content is current: fetch all
//               chunk snapshots in one batched IPC and apply them, skipping
//               the multi-MB base snapshot decode;
//   stale     — any edit changes the stored vector, the fast path misses, and
//               the legacy whole-doc path runs; an idle rebuild refreshes the
//               index so the next open is fast again.
//
// Chunks are always rebuildable from the base log, so index corruption or
// absence degrades to today's behavior, never to data loss. The manifest
// carries a title mirror because the fast path skips the base snapshot (which
// is where the title normally lives).

export const CHUNK_MANIFEST_KEY = 'manifest';

/**
 * Normalize schema-less yjs→PM JSON into schema-parseable PM JSON: drops
 * nodes/marks the editor schema doesn't know (keeps the seeded chunks
 * parseable for ANY plugin content) and preserves text/marks/attrs verbatim.
 */
export function normalizeNodeJson(schema, json) {
  if (!json || typeof json !== 'object' || !json.type) return null;
  if (json.type === 'text') {
    const out = { type: 'text', text: typeof json.text === 'string' ? json.text : '' };
    if (Array.isArray(json.marks)) {
      const marks = json.marks.filter((m) => m && m.type && schema.marks[m.type]);
      if (marks.length) out.marks = marks;
    }
    return out;
  }
  if (!schema.nodes[json.type]) return null;
  const out = { type: json.type };
  if (json.attrs && Object.keys(json.attrs).length) out.attrs = json.attrs;
  if (Array.isArray(json.content)) {
    const kids = json.content.map((c) => normalizeNodeJson(schema, c)).filter(Boolean);
    if (kids.length) out.content = kids;
  }
  return out;
}

export function readManifestDoc(doc) {
  try {
    const map = doc?.getMap?.(CHUNK_MANIFEST_KEY);
    if (!map || map.size === 0) return null;
    const out = {};
    for (const [key, value] of map.entries()) out[key] = value;
    return out.chunks ? out : null;
  } catch {
    return null;
  }
}

/** Load the manifest slot; null when the note has no chunk index. */
export async function readManifest(noteId) {
  let snapshot;
  try {
    snapshot = await getSnapshot(manifestSlotId(noteId));
  } catch {
    return null;
  }
  if (!snapshot || (typeof snapshot === 'string' && snapshot.length === 0)) return null;
  let doc;
  try {
    doc = new Y.Doc();
    Y.applyUpdate(doc, toUint8Array(snapshot), 'load');
    return readManifestDoc(doc);
  } catch {
    return null;
  } finally {
    doc?.destroy();
  }
}

// State vectors travel as JSON maps (clientId -> clock) from Rust; key order
// is not stable, so compare structurally.
export function svEquals(a, b) {
  if (!a || !b) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka) {
    if (Number(a[k]) !== Number(b[k])) return false;
  }
  return true;
}

/** Decide the open path from cheap probes. Pure; exported for unit testing. */
export function planOpenPath({ manifest, storedStateVector, contentVersion }) {
  if (!manifest?.version || !Array.isArray(manifest?.chunks) || manifest.chunks.length === 0) {
    return 'full';
  }
  // Old seeder generations are never served: gen 1 (carve) merges to an empty
  // document. The idle rebuild rewrites the index in the current generation.
  if (manifest.seedGen !== CHUNK_SEEDER_VERSION) return 'full';
  // Cheap probe: the manifest records the content version the index was built
  // from. It moves only when the stored state changes, so a match proves the
  // index is current without decoding the whole content blob (the state
  // vector costs a full document rebuild — over a second on big notes).
  if (typeof manifest.contentVersion === 'number') {
    return contentVersion === manifest.contentVersion ? 'chunks' : 'full';
  }
  // Legacy manifests carry the stored state vector instead.
  if (!manifest.watermark || !storedStateVector) return 'full';
  if (!svEquals(manifest.watermark, storedStateVector)) return 'full';
  return 'chunks';
}

/**
 * Rebuild the chunk index from the merged doc: split, seed each chunk slot,
 * and write the manifest slot. The merged doc is NOT mutated (read-only
 * source), so no persistence churn is created. Returns the manifest, or null
 * when the content does not justify chunking. Never throws into the caller's
 * edit path: failures degrade to the legacy whole-doc path on next open.
 */
export async function rebuildChunkIndex(noteId, mergedDoc, { previousManifest, onProgress } = {}) {
  if (!noteId || !mergedDoc) return null;
  const frag = mergedDoc.getXmlFragment('content');
  if (frag.length === 0) return null;
  // Captured before any await: an older version only makes the index look
  // stale (the open falls back to the full path), a newer one could serve
  // chunks that miss rows appended after the capture.
  const contentVersion = await getContentVersion(noteId);

  // frag.toJSON() yields an XML string, not PM JSON — the planner needs the
  // ProseMirror shape. The schema-less converter can emit nodes/children the
  // schema can't parse back (observed: "Unknown node type: undefined"), so
  // the JSON is normalized against the editor schema before planning and
  // seeding; unparseable nodes are dropped from chunks only (the live doc
  // keeps them, and the watermark marks the index stale if content shifts).
  let contentJson;
  try {
    const [{ yXmlFragmentToProsemirrorJSON }, schema] = await Promise.all([
      import('@tiptap/y-tiptap'),
      ensureSchema(),
    ]);
    const raw = yXmlFragmentToProsemirrorJSON(frag);
    contentJson = { content: (raw.content || []).map((n) => normalizeNodeJson(schema, n)).filter(Boolean) };
  } catch (err) {
    console.warn('[yjs] chunk index: content conversion failed:', err?.message);
    return null;
  }
  const serialized = JSON.stringify(contentJson);
  if (serialized.length <= CHUNK_TRIGGER_BYTES && frag.length < CHUNK_MIN_NODES) {
    return null; // small doc: no index
  }
  const plans = planChunks(contentJson);
  if (plans.length === 0) return null;

  const hashes = await Promise.all(plans.map((plan) => contentHashOf(plan)));
  const manifest = buildManifest(plans, noteId, { previous: previousManifest, hashes });

  for (let i = 0; i < plans.length; i++) {
    const slot = chunkSlotId(noteId, i);
    const doc = await seedChunkDoc(plans[i], slot);
    try {
      const state = Y.encodeStateAsUpdate(doc);
      // Derived slot: replace wholesale. A plain compact gets refused by
      // Rust when the fresh state doesn't cover the previous slot's rows —
      // carve tombstones are temp-doc-local, so they never do. Clear first;
      // a reader racing the deletion just falls back to the full path.
      await deleteUpdates(slot);
      await compactUpdates(slot, state);
    } finally {
      doc.destroy();
    }
    onProgress?.(i + 1, plans.length);
    // Yield between chunks so a long rebuild never pins the main thread for
    // ~1 s on a huge note. Chunk slots are independent; a yielded slice lets
    // paint/input run between them. IPC calls above already await, but
    // Y.encodeStateAsUpdate + per-chunk Y.Doc seeding run synchronously.
    if (i + 1 < plans.length) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  // Drop superseded tail slots when the chunk count shrank.
  const previousCount = previousManifest?.chunks?.length || 0;
  for (let i = plans.length; i < previousCount; i++) {
    try {
      await deleteUpdates(chunkSlotId(noteId, i));
    } catch {
      /* best effort */
    }
  }

  manifest.contentVersion = contentVersion;
  const title = mergedDoc.getText('title').toString();
  await writeManifestSlot(noteId, { ...manifest, title });
  return manifest;
}

/** Upgrade a legacy (state-vector) manifest once its freshness is proven. */
export async function upgradeManifestVersion(noteId, manifest, contentVersion) {
  if (typeof contentVersion !== 'number') return;
  try {
    await writeManifestSlot(noteId, { ...manifest, contentVersion });
  } catch (err) {
    console.warn('[yjs] manifest version upgrade failed:', err?.message);
  }
}

async function writeManifestSlot(noteId, manifest) {
  const doc = new Y.Doc();
  try {
    const map = doc.getMap(CHUNK_MANIFEST_KEY);
    doc.transact(() => {
      for (const [key, value] of Object.entries(manifest)) map.set(key, value);
    });
    // Same derived-slot rule as the chunk slots: clear, then write fresh —
    // the new manifest state never covers a previous manifest's structs.
    await deleteUpdates(manifestSlotId(noteId));
    await compactUpdates(manifestSlotId(noteId), Y.encodeStateAsUpdate(doc));
  } finally {
    doc.destroy();
  }
}

/**
 * Fast-path load: fetch chunk snapshots in one batched IPC call and apply
 * them into `targetDoc` in manifest order. When `slotKeys` is given (array of
 * chunk slot keys), only those chunks are fetched and applied — used for
 * lazy loading where off-screen chunks are deferred until the user scrolls
 * to them. Returns false when any requested chunk is unreadable, so the
 * caller falls back to the legacy whole-doc path.
 */
export async function loadChunksIntoDoc(noteId, manifest, targetDoc, slotKeys = null) {
  const slots = slotKeys ?? manifest.chunks.map((c) => c.key);
  let snapshots;
  try {
    snapshots = await getSnapshots(slots);
  } catch {
    return false;
  }
  const states = [];
  for (const slot of slots) {
    const snap = snapshots?.[slot];
    if (!snap || (typeof snap === 'string' && snap.length === 0)) return false;
    states.push(toUint8Array(snap));
  }
  applyChunksToDoc(targetDoc, states);
  return true;
}
