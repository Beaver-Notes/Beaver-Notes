import * as Y from 'yjs';
import { getSyncDeviceId } from '@/utils/sync/sync-repository.js';
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
 * Apply an array of updates (Uint8Array, number[], or base64 string) to a
 * Y.Doc, skipping corrupted ones.
 */
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
 * Ensure a Yjs binary value is a Uint8Array.
 * Accepts Uint8Array, number[], or a base64 string (the IPC wire format).
 */
export function toUint8Array(data) {
  if (data instanceof Uint8Array) return data;
  if (typeof data === 'string') return base64ToUint8Array(data);
  return new Uint8Array(data);
}

function base64ToUint8Array(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Build a ProseMirror schema from TipTap extensions, cached globally.
 * Used for seeding Y.Docs from legacy JSON content.
 *
 * The editor stack (yjsExtensions + CollapseHeading + heading) is imported
 * lazily so the boot bundle does not pay for mermaid/katex/markdown-it etc.
 * before the first screen renders.
 */
export async function ensureSchema() {
  if (cachedSchema) return cachedSchema;
  const [{ yjsExtensions, CollapseHeading, heading }, { Editor }] =
    await Promise.all([
      import('@/lib/tiptap'),
      import('@tiptap/core'),
    ]);
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
