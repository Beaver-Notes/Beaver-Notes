import * as Y from 'yjs';
import { getSyncDeviceId } from '@/utils/sync/sync-repository.js';
import { yjsExtensions, CollapseHeading, heading } from '@/lib/tiptap';
import { base64ToBuf } from '@/utils/crypto/codec.js';
import { useAppStore } from '@/store/app';

let cachedSchema = null;

export function getDeviceId() {
  try {
    return getSyncDeviceId();
  } catch {
    return 'local';
  }
}

export function yMapToObj(yMap) {
  if (!yMap || typeof yMap.get !== 'function') return yMap;
  const out = {};
  for (const [key, value] of yMap.entries()) {
    out[key] = value instanceof Y.Map ? yMapToObj(value) : value;
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

/**
 * Ensure a Yjs binary value is a Uint8Array. IPC delivers binary as base64
 * strings (see commands.ts); numeric arrays are the legacy shape.
 */
export function toUint8Array(data) {
  if (data instanceof Uint8Array) return data;
  if (typeof data === 'string') {
    if (data === '') return new Uint8Array(0);
    return base64ToBuf(data);
  }
  return new Uint8Array(data);
}

/**
 * Build a ProseMirror schema from TipTap extensions, cached globally;
 * used for seeding Y.Docs from legacy JSON content.
 */
export async function ensureSchema() {
  if (cachedSchema) return cachedSchema;
  const { Editor } = await import('@tiptap/core');
  // Must match the live Yjs editor's extension set (incl. the collapsible
  // heading variant) — using the plain heading node produced mismatched/empty
  // content when collapsible headings were enabled.
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
