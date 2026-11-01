import { logger } from '@/utils/logger';
import { isSharedNote } from '@/utils/sync/shared-notes.js';

// Tell the Rust engine which collaboration key seals a note's durable sync
// payload: the per-note key for a shared note, or the workspace key for the
// `meta` doc. Without this the cloud path falls back to the account items key,
// which no other account can read.
//
// The raw key never leaves the device: it is held in the Rust session only,
// cleared on lock/workspace switch.
const registered = new Map();
// Notes locked to the workspace key. A device-local per-note ring must never
// replace it: peers could no longer read the note's later updates.
const wsSealed = new Set();
// Notes locked to their own note key because someone outside the workspace is
// meant to read them (a note shared to another account). The workspace sweep
// must not put the workspace key back: invitees are not members and could never
// obtain that key, so the note key — the one their envelopes carry — has to
// stay the sealing key.
const noteKeyLocked = new Set();

// One shared import promise: a concurrent sweep must not fire N racing
// dynamic imports (module resolution is cached after the first).
let backendPromise = null;
function getBackend() {
  if (!backendPromise) {
    backendPromise = import('@/lib/tauri-bridge').then(({ backend }) => backend);
  }
  return backendPromise;
}

export async function registerSharedSyncKey(noteId, keyHex, previousKeys = [], { takeover = false } = {}) {
  if (!noteId || typeof keyHex !== 'string' || !keyHex) return false;
  const previous = Array.isArray(previousKeys) ? previousKeys.filter(Boolean) : [];
  const isWsKey = !!activeWsKeyHex && keyHex === activeWsKeyHex;
  if (!isWsKey) {
    // Locked notes keep their registered ring unless this is a deliberate
    // takeover by the note's own key (an external reader was granted access).
    if (!takeover && (wsSealed.has(noteId) || noteKeyLocked.has(noteId))) return true;
    if (takeover) {
      wsSealed.delete(noteId);
      noteKeyLocked.add(noteId);
    }
  }
  const signature = keySignature(keyHex, previous);
  if (registered.get(noteId) === signature) return true;
  // A failed registration leaves the session sealing this note under the
  // account items key, which no peer can ever open, so it is worth one retry
  // and a loud log instead of an invisible warning (F32).
  let lastError = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const backend = await getBackend();
      if (!backend) {
        lastError = new Error('no backend');
        continue;
      }
      await backend.invoke('sync:registerSharedKey', { noteId, keyHex, previousKeys: previous });
      registered.set(noteId, signature);
      if (isWsKey) wsSealed.add(noteId);
      return true;
    } catch (err) {
      lastError = err;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  logger.error(
    `[shared-keys] register failed for ${noteId} after retry:`,
    lastError?.message || lastError,
  );
  return false;
}

// Identity of a (key, previous ring) registration: two identical signatures
// mean the session already holds exactly this ring for the note, so neither
// path (single note, sweep batch) re-invokes.
const keySignature = (keyHex, previous) => JSON.stringify([keyHex, previous]);

// The active workspace key, applied to workspace note ids as they appear (the
// meta-doc observer and the initial sweep) so note bodies seal under the
// workspace key every member can read, not the account items key.
let activeWsKeyHex = null;

export function setActiveWsKey(keyHex) {
  activeWsKeyHex = typeof keyHex === 'string' && keyHex ? keyHex : null;
}

export function getActiveWsKey() {
  return activeWsKeyHex;
}

// `keyHex` overrides the active workspace key. Callers that know which
// workspace a note id belongs to must pass it: the global is whichever
// workspace was active last, and registering the wrong workspace's key seals
// that note's future rows so no peer can read them.
export async function registerWsKeyForNotes(noteIds, keyHex = activeWsKeyHex) {
  if (!keyHex) return;
  const signature = keySignature(keyHex, []);
  // A sweep can see the same id twice (meta + workspace lists): the Rust merge
  // is idempotent, but the batch carries each id once.
  const pending = [...new Set(noteIds)].filter((noteId) => {
    // Shared-to-me notes seal under their own note key, not this workspace's:
    // the owning workspace's members never hold the invitee's workspace key,
    // so a sweep registration here makes their rows undecryptable forever.
    if (isSharedNote(noteId)) return false;
    // A note already sealed under the workspace key is up to date; one sealed
    // under a device-local ring still upgrades (registerSharedSyncKey refuses
    // the reverse, so the two paths cannot alternate). A note locked to its own
    // key serves an external reader the workspace key can never reach.
    if (wsSealed.has(noteId) || noteKeyLocked.has(noteId)) return false;
    // Same signature dedupe registerSharedSyncKey applies per note.
    return registered.get(noteId) !== signature;
  });
  if (!pending.length) return;
  // One IPC for the whole sweep: the Rust command answers per item and is
  // idempotent per note, while retry and dedupe stay JS-side — so one failing
  // note (2 attempts, 500 ms between them) cannot stall the rest of the sweep.
  const isWsKey = !!activeWsKeyHex && keyHex === activeWsKeyHex;
  let remaining = pending.map((noteId) => ({ noteId, lastError: null }));
  for (let attempt = 0; attempt < 2 && remaining.length; attempt += 1) {
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 500));
    try {
      const backend = await getBackend();
      if (!backend) {
        remaining.forEach((entry) => {
          entry.lastError = new Error('no backend');
        });
        continue;
      }
      const results = await backend.invoke('sync:registerSharedKeys', {
        entries: remaining.map((entry) => ({ noteId: entry.noteId, keyHex })),
      });
      // Per-item Rust results: `{ Ok: null }` on success, `{ Err: { message } }`
      // on failure. A malformed answer fails every entry (it gets retried).
      const wellFormed = Array.isArray(results) && results.length === remaining.length;
      const failed = [];
      remaining.forEach((entry, i) => {
        const result = wellFormed ? results[i] : null;
        if (result && !result.Err) {
          registered.set(entry.noteId, signature);
          if (isWsKey) wsSealed.add(entry.noteId);
        } else {
          entry.lastError =
            result?.Err ?? new Error('malformed registerSharedKeys result');
          failed.push(entry);
        }
      });
      remaining = failed;
    } catch (err) {
      // Transport-level failure: the whole batch is unknown, retry every entry.
      remaining.forEach((entry) => {
        entry.lastError = err;
      });
    }
  }
  for (const entry of remaining) {
    logger.error(
      `[shared-keys] register failed for ${entry.noteId} after retry:`,
      entry.lastError?.message || entry.lastError,
    );
  }
}

export async function clearSharedSyncKeys() {
  registered.clear();
  wsSealed.clear();
  noteKeyLocked.clear();
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

