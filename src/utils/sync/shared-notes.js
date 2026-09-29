import { logger } from '@/utils/logger';
import { useNoteStore } from '@/store/note';

// Notes invited to this account by a single note's owner, without workspace
// membership. They live in the active workspace's meta doc (one local store),
// so the owning workspace id rides along on the note itself as `access` and is
// cleared when the note stops being shared. Nothing here is persisted outside
// the note, so losing session state can no longer make a shared note look like
// the caller's own.
//
// The Rust durable-sync engine reads sqlite, not the Yjs meta doc, so it is
// still told which notes to skip — mirrored from `access` on every fetch.

function accessOf(noteId) {
  if (!noteId) return null;
  return useNoteStore().data[noteId]?.access ?? null;
}

// A role the server never sends defaults to editor, matching the old behaviour
// of treating anything but an explicit viewer grant as full edit access.
function normalizeRole(role) {
  return role === 'viewer' ? 'viewer' : 'editor';
}

export function isSharedNote(noteId) {
  return Boolean(accessOf(noteId)?.workspaceId);
}

// The workspace a note must sync/join against: its owning workspace when shared
// with this account, else the caller's active workspace.
export function resolveNoteWorkspaceId(noteId, fallback) {
  return accessOf(noteId)?.workspaceId || fallback || null;
}

async function getBackend() {
  try {
    const { backend } = await import('@/lib/tauri-bridge');
    return backend;
  } catch {
    return null;
  }
}

// Record (or, with an empty workspaceId, forget) a shared note in the Rust
// session so the workspace push leaves its content in the owning workspace
// instead of copying it into the caller's own. Per-session cache, not truth.
export async function registerSharedNoteLocation(noteId, workspaceId) {
  if (!noteId) return false;
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

// Durable pull+push of exactly one shared note under its owning workspace id.
export async function syncSharedNote(noteId, { serverUrl = '', token = '' } = {}) {
  const workspaceId = accessOf(noteId)?.workspaceId;
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

// Reconcile the notes against the server's authoritative list: stamp the grant
// on each shared note, drop it from any note that is no longer shared, and
// mirror the result into the Rust session. No-op when nothing changed, so the
// caller's `updatedAt` is left alone.
export async function applySharedNoteAccess(rows) {
  const noteStore = useNoteStore();
  const next = new Map();
  for (const row of rows || []) {
    if (row?.noteId && row.workspaceId) next.set(row.noteId, row);
  }

  const changed = [];
  const stamp = (noteId, access) => {
    const note = noteStore.data[noteId];
    if (!note) return;
    // `updatedAt` describes the shared note's content, not when this account
    // last reconciled its list, so it must not move here.
    noteStore.patchLocal(noteId, { access, updatedAt: note.updatedAt });
    changed.push([noteId, access?.workspaceId || '']);
  };

  for (const [noteId, row] of next) {
    const access = accessOf(noteId);
    if (access?.workspaceId === row.workspaceId && access?.role === normalizeRole(row.role)) {
      continue;
    }
    stamp(noteId, {
      role: normalizeRole(row.role),
      workspaceId: row.workspaceId,
      by: row.invitedBy || undefined,
    });
  }
  for (const noteId of Object.keys(noteStore.data)) {
    if (next.has(noteId) || !noteStore.data[noteId].access) continue;
    stamp(noteId, undefined);
  }

  await Promise.all(changed.map(([noteId, workspaceId]) => {
    noteStore.persistMeta(noteId);
    return registerSharedNoteLocation(noteId, workspaceId);
  }));
  return changed.length;
}
