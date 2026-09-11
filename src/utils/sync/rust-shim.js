// Editor reintegration for the Rust sync scheduler (Task 4).
//
// The Rust side owns the durable cycle (`sync_start` tick + `sync:applied
// { noteIds }` events, see `src-tauri/src/sync/scheduler.rs`). This shim:
// - starts/stops the scheduler and applies pulled snapshots with origin
//   `'sync'`, so the Y.Doc observer (`useNoteYjs`) skips re-queue (no echo);
// - exposes debounced `sync_kick` (WS notify-only, 500ms) and
//   `sync_kick_dirty` (immediate-on-dirty push) triggers.
//
// NOTE: there is no `yjs_get_updates_since` command in Rust (verified) and
// `sync:applied` carries no `since` cursor, so deltas are fetched via the
// existing `yjs:getSnapshot`: one merged blob per note, and snapshot bytes
// are a valid Y update (`Y.applyUpdate` merges, Yjs dedupes re-application).
// Closed notes need no action: next open replays from SQLite.
//
// Top-level imports stay light (shared + codec only); stores and the Tauri
// bridge load dynamically so unit tests never pull the app runtime.

import { applyRemote } from '@/lib/yjs/shared.js';
import { base64ToBuf } from '@/utils/crypto/codec.js';

let rustSyncActive = false;
let unlistenApplied = null;
let kickTimer = null;
let dirtyTimer = null;

/** True once `startRustSync()` succeeds; gates the legacy JS engine cycle. */
export function isRustSyncActive() {
  return rustSyncActive;
}

async function getSyncConfig() {
  const { useAccountStore } = await import('@/store/account');
  const { useWorkspaceStore } = await import('@/store/workspace');
  const { getSyncPath } = await import('./path.js');
  let folderId = '';
  try {
    folderId = (await getSyncPath()) || '';
  } catch {
    folderId = '';
  }
  // snake_case: unknown `sync:*` channels pass through to the Rust command
  // names verbatim (`sync:start` → `sync_start`). Empty strings are safe:
  // Rust falls back to the default server URL and skips empty folder/token.
  return {
    workspace_id: useWorkspaceStore().activeId || '',
    server_url: useAccountStore().serverUrl || '',
    token: useAccountStore().token || '',
    folder_id: folderId,
  };
}

async function invokeSync(channel) {
  const { backend } = await import('@/lib/tauri-bridge');
  return backend.invoke(channel, await getSyncConfig());
}

/** Fetch one snapshot per applied note and merge it locally (origin `'sync'`). */
export async function applySyncedNotes(noteIds) {
  if (!noteIds?.length) return;
  const { backend } = await import('@/lib/tauri-bridge');
  for (const noteId of noteIds) {
    try {
      const snapshot = await backend.invoke('yjs:getSnapshot', noteId);
      if (!snapshot) continue;
      applyRemote(noteId, base64ToBuf(snapshot));
    } catch {
      // A failed apply must never break anything: next open replays from SQLite.
    }
  }
}

export async function startRustSync() {
  await invokeSync('sync:start');
  rustSyncActive = true;
  if (!unlistenApplied) {
    const { backend } = await import('@/lib/tauri-bridge');
    unlistenApplied = await backend.listenPayload('sync:applied', (payload) => {
      applySyncedNotes(payload?.noteIds ?? []).catch(() => {});
    });
  }
}

export async function stopRustSync() {
  rustSyncActive = false;
  if (unlistenApplied) {
    try {
      await unlistenApplied();
    } catch {
      // Listener teardown is best-effort.
    }
    unlistenApplied = null;
  }
  if (kickTimer) {
    clearTimeout(kickTimer);
    kickTimer = null;
  }
  if (dirtyTimer) {
    clearTimeout(dirtyTimer);
    dirtyTimer = null;
  }
  try {
    const { backend } = await import('@/lib/tauri-bridge');
    await backend.invoke('sync:stop', {});
  } catch {
    // Scheduler already stopped (or never started): nothing to do.
  }
}

/**
 * WS notify-only path: coalesce notification storms 500ms, then wake the
 * Rust scheduler (which debounces again at 500ms). Returns true when Rust
 * owns the cycle; false lets the caller fall back to the legacy engine.
 */
export function kickRustSync() {
  if (!rustSyncActive) return false;
  if (kickTimer) return true;
  kickTimer = setTimeout(async () => {
    kickTimer = null;
    try {
      await invokeSync('sync:kick');
    } catch {
      // Next 30s tick surfaces persistent problems.
    }
  }, 500);
  return true;
}

/** Immediate-on-dirty push after the local SQLite flush (coalesced ~1s). */
export function kickRustDirty() {
  if (!rustSyncActive) return;
  if (dirtyTimer) return;
  dirtyTimer = setTimeout(async () => {
    dirtyTimer = null;
    try {
      await invokeSync('sync:kick-dirty');
    } catch {
      // Budget-gated or offline: the next tick picks it up.
    }
  }, 1000);
}
