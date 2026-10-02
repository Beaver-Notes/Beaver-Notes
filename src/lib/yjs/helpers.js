import * as Y from 'yjs';
import { getSyncDeviceId } from '@/utils/sync/sync-repository.js';
import { yjsExtensions, CollapseHeading, heading } from '@/lib/tiptap';
import { base64ToBuf } from '@/utils/crypto/codec.js';
import { useAppStore } from '@/store/app';

let cachedSchema = null;

let cachedDeviceId = null;
try {
  cachedDeviceId = localStorage.getItem('deviceId');
} catch {}
// Warm the Rust-owned id in the background; kv adopts the localStorage seed
// so the sync cached value stays the correct identity.
Promise.resolve()
  .then(() => getSyncDeviceId())
  .then((id) => {
    if (typeof id === 'string' && id) cachedDeviceId = id;
  })
  .catch(() => {});

export function getDeviceId() {
  try {
    if (cachedDeviceId) return cachedDeviceId;
    const fresh = localStorage.getItem('deviceId');
    if (fresh) {
      cachedDeviceId = fresh;
      return fresh;
    }
    return 'local';
  } catch {
    return 'local';
  }
}

/**
 * Stable 32-bit client id derived from a seed string (FNV-1a).
 * Used so every device that seeds the same note authors identical structs
 * under the same client id, letting Yjs merge them into one copy.
 */
export function deterministicClientId(seed) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  hash >>>= 0;
  return hash === 0 ? 1 : hash;
}

/**
 * Apply seed content built in a throwaway doc whose client id is derived from
 * `seedKey`. Concurrent seeds of identical content merge into a single copy
 * instead of concatenating (e.g. two clients opening a fresh note).
 */
export function seedDeterministically(ydoc, seedKey, build, origin = 'load') {
  const temp = new Y.Doc();
  temp.clientID = deterministicClientId(seedKey);
  build(temp);
  Y.applyUpdate(ydoc, Y.encodeStateAsUpdate(temp), origin);
  temp.destroy();
}

/** Yjs value -> plain JS value. Recurses into Y.Map and Y.Array (label lists). */
function toPlainValue(value) {
  if (value instanceof Y.Map) return yMapToObj(value);
  if (value instanceof Y.Array) return value.toArray().map(toPlainValue);
  return value;
}

export function yMapToObj(yMap) {
  if (!yMap || typeof yMap.get !== 'function') return yMap;
  const out = {};
  for (const [key, value] of yMap.entries()) {
    out[key] = toPlainValue(value);
  }
  return out;
}

export function objToYMap(obj) {
  const map = new Y.Map();
  for (const [key, value] of Object.entries(obj)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      map.set(key, objToYMap(value));
    } else {
      map.set(key, value);
    }
  }
  return map;
}

/** Apply updates (base64 strings, Uint8Array or number[]), skipping corrupted ones. */
export function applyUpdatesToDoc(doc, updates) {
  if (!updates || updates.length === 0) return;
  for (const u of updates) {
    try {
      Y.applyUpdate(doc, toUint8Array(u));
    } catch (e) {
      console.warn('[yjs] skipping corrupted update:', e);
    }
  }
}

/** Ensure Yjs binary is Uint8Array. IPC delivers base64 strings, numeric arrays are legacy. */
export function toUint8Array(data) {
  if (data instanceof Uint8Array) return data;
  if (typeof data === 'string') {
    if (data === '') return new Uint8Array(0);
    return base64ToBuf(data);
  }
  return new Uint8Array(data);
}

/** Build ProseMirror schema from TipTap extensions, cached. For seeding Y.Docs from legacy JSON. */
export async function ensureSchema() {
  if (cachedSchema) return cachedSchema;
  const { Editor } = await import('@tiptap/core');
  // Must match live editor extensions (incl. collapsible heading): plain heading produced mismatched content.
  const appStore = useAppStore();
  const headingExt = appStore.setting?.collapsibleHeading
    ? CollapseHeading
    : heading;
  const editor = new Editor({
    extensions: [...yjsExtensions, headingExt],
    element: document.createElement('div'),
  });
  cachedSchema = editor.schema;
  editor.destroy();
  return cachedSchema;
}
