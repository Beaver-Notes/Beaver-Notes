import * as Y from 'yjs';
import { getSyncDeviceId } from '@/utils/sync/sync-repository.js';
import { yjsExtensions, CollapseHeading, heading } from '@/lib/tiptap';
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

/**
 * Apply an array of updates (Uint8Array or number[]) to a Y.Doc,
 * skipping corrupted ones.
 */
export function applyUpdatesToDoc(doc, updates) {
  if (!updates || updates.length === 0) return;
  for (const u of updates) {
    try {
      Y.applyUpdate(doc, u instanceof Uint8Array ? u : new Uint8Array(u));
    } catch (e) {
      console.warn('[yjs] skipping corrupted update:', e);
    }
  }
}

/**
 * Ensure a Yjs binary value is a Uint8Array.
 */
export function toUint8Array(data) {
  if (data instanceof Uint8Array) return data;
  return new Uint8Array(data);
}

/**
 * Build a ProseMirror schema from TipTap extensions, cached globally.
 * Used for seeding Y.Docs from legacy JSON content.
 */
export async function ensureSchema() {
  if (cachedSchema) return cachedSchema;
  const { Editor } = await import('@tiptap/core');
  // Seed Y.Docs from the SAME extension set the live Yjs editor uses
  // (yjsExtensions + the heading variant selected by settings), so the
  // schema matches what ySyncPlugin expects. Using the non-Yjs `extensions`
  // with the plain `heading` node previously produced mismatched/empty
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
