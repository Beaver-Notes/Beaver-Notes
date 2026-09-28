import { logger } from '@/utils/logger';

// Notes invited to a caller who is not a member of the owning workspace. Each
// note is stored locally in the *active* workspace's db (the app has no
// cross-workspace local store), so the durable engine would otherwise push it
// under the active workspace id and copy it into the caller's own workspace.
//
// Two things ride on this map:
//   1. the durable sync engine skips these notes for the active-workspace push
//      (they sync through `sync:cloud-note` under the owning workspace id), and
//   2. the Home view lists them under "Shared with me" instead of "All".
//
// It is a client-side map (not part of the note's Yjs meta), persisted in
// localStorage, and mirrored into the Rust session on startup.
const STORAGE_KEY = 'shared-with-me';

let locations = null;

function loadLocations() {
  if (locations) return locations;
  locations = new Map();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === 'object') {
      for (const [noteId, workspaceId] of Object.entries(parsed)) {
        if (noteId && typeof workspaceId === 'string' && workspaceId) {
          locations.set(noteId, workspaceId);
        }
      }
    }
  } catch {
    // Best-effort: a corrupt entry just means the list is refetched.
  }
  return locations;
}

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(loadLocations())));
  } catch {
    // Best-effort: the server list is authoritative and refetched.
  }
}

async function getBackend() {
  try {
    const { backend } = await import('@/lib/tauri-bridge');
    return backend;
  } catch {
    return null;
  }
}

export function getSharedNoteWorkspaceId(noteId) {
  if (!noteId) return null;
  return loadLocations().get(noteId) ?? null;
}

export function isSharedNote(noteId) {
  return Boolean(getSharedNoteWorkspaceId(noteId));
}

// The workspace a note must sync/join against: its owning workspace for a
// shared-with-me note, else the caller's active workspace.
export function resolveNoteWorkspaceId(noteId, fallback) {
  return getSharedNoteWorkspaceId(noteId) || fallback || null;
}

export function getSharedNoteList() {
  return Array.from(loadLocations(), ([noteId, workspaceId]) => ({ noteId, workspaceId }));
}

// Reconcile the persisted map with the server's authoritative list: add/update
// the returned notes and drop any no longer shared with the caller.
export function setSharedNoteList(rows) {
  const next = new Map();
  for (const row of rows || []) {
    if (row?.noteId && row.workspaceId) next.set(row.noteId, row.workspaceId);
  }
  locations = next;
  persist();
  return getSharedNoteList();
}

// Record (or, with an empty workspaceId, forget) the owning workspace of a
// shared note and mirror it into the Rust session. Safe to call repeatedly.
export async function registerSharedNoteLocation(noteId, workspaceId) {
  if (!noteId) return false;
  const map = loadLocations();
  if (workspaceId) map.set(noteId, workspaceId);
  else map.delete(noteId);
  persist();
  try {
    const backend = await getBackend();
    await backend?.invoke('sync:registerSharedNoteLocation', {
      noteId,
      workspaceId: workspaceId || '',
    });
    return true;
  } catch (err) {
    logger.warn('[shared-notes] register location failed:', err?.message || err);
    return false;
  }
}

export function forgetSharedNoteLocation(noteId) {
  if (!noteId) return false;
  loadLocations().delete(noteId);
  persist();
  return true;
}

// Push the persisted map into the Rust session (it is dropped on lock/restart).
export async function rehydrateSharedNoteLocations() {
  const entries = getSharedNoteList();
  await Promise.all(
    entries.map(({ noteId, workspaceId }) => registerSharedNoteLocation(noteId, workspaceId))
  );
  return entries.length;
}

// Durable pull+push of exactly one shared note under its owning workspace id.
export async function syncSharedNote(noteId, { serverUrl = '', token = '' } = {}) {
  const workspaceId = getSharedNoteWorkspaceId(noteId);
  if (!noteId || !workspaceId) return false;
  try {
    const backend = await getBackend();
    if (!backend) return false;
    await backend.invoke('sync:cloud-note', { noteId, workspaceId, serverUrl, token });
    return true;
  } catch (err) {
    logger.warn('[shared-notes] single-note sync failed:', err?.message || err);
    return false;
  }
}

// Test seam: forget the in-memory cache (keeps localStorage).
export function _resetSharedNotesCache() {
  locations = null;
}
