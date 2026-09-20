import { logger } from '@/utils/logger';

// Tell the Rust engine which collaboration key seals a note's durable sync
// payload: the per-note key for a shared note, or the workspace key for the
// `meta` doc. Without this the cloud path falls back to the account items key,
// which no other account can read.
//
// The raw key never leaves the device: it is held in the Rust session only,
// cleared on lock/workspace switch.
const registered = new Map();

async function getBackend() {
  try {
    const { backend } = await import('@/lib/tauri-bridge');
    return backend;
  } catch {
    return null;
  }
}

export async function registerSharedSyncKey(noteId, keyHex, previousKeys = []) {
  if (!noteId || typeof keyHex !== 'string' || !keyHex) return false;
  const previous = Array.isArray(previousKeys) ? previousKeys.filter(Boolean) : [];
  const signature = JSON.stringify([keyHex, previous]);
  if (registered.get(noteId) === signature) return true;
  try {
    const backend = await getBackend();
    if (!backend) return false;
    await backend.invoke('sync:registerSharedKey', { noteId, keyHex, previousKeys: previous });
    registered.set(noteId, signature);
    return true;
  } catch (err) {
    logger.warn('[shared-keys] register failed:', err?.message || err);
    return false;
  }
}

export async function clearSharedSyncKeys() {
  registered.clear();
  try {
    const backend = await getBackend();
    await backend?.invoke('sync:clearSharedKeys', {});
  } catch {
    // Best-effort: the Rust session keys are dropped on lock anyway.
  }
}

// Mark a note as expected to be shared (cross-account collaborators) so the
// Rust engine defers sealing it with the account items key until
// registerSharedSyncKey lands. Without this, a push that races key resolution
// seals v5 and a peer can never decrypt the update (finding C1). Registration
// clears the mark; expected=false restores the v5 items-key path.
export async function expectSharedSyncNote(noteId, expected = true) {
  if (!noteId) return false;
  try {
    const backend = await getBackend();
    if (!backend) return false;
    await backend.invoke('sync:expectSharedNote', { noteId, expected });
    return true;
  } catch (err) {
    logger.warn('[shared-keys] expect failed:', err?.message || err);
    return false;
  }
}

// Test seam: forget the local dedupe cache without touching the backend.
export function _resetSharedSyncKeyCache() {
  registered.clear();
}
