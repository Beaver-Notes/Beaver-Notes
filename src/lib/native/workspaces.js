import { backend } from '@/lib/tauri-bridge';

export async function listLocalWorkspaces() {
  return backend.invoke('workspace:list');
}

export async function getActiveLocalWorkspace() {
  return backend.invoke('workspace:getActive');
}

export async function deleteLocalWorkspace(workspaceId) {
  return backend.invoke('workspace:delete', workspaceId);
}

export async function archiveLocalWorkspace(workspaceId) {
  return backend.invoke('workspace:archive', workspaceId);
}

export async function listArchivedWorkspaces() {
  return backend.invoke('workspace:archivedList');
}

export async function restoreLocalWorkspace(workspaceId) {
  return backend.invoke('workspace:restore', workspaceId);
}

export async function localNotesCopied(workspaceId) {
  return backend.invoke('workspace:notesCopied', workspaceId);
}

export async function markLocalNotesCopied(workspaceId) {
  return backend.invoke('workspace:markNotesCopied', workspaceId);
}

export async function detachLocalWorkspace(workspaceId) {
  return backend.invoke('workspace:detach', workspaceId);
}

export async function registerLocalWorkspace({
  id,
  name,
  orgId = null,
  ownerId = null,
  workspaceType = 'shared',
  createdAt = null,
} = {}) {
  return backend.invoke('workspace:registerCloud', {
    id,
    name,
    orgId,
    ownerId,
    workspaceType,
    createdAt,
  });
}

export async function switchLocalWorkspace(workspaceId) {
  return backend.invoke('workspace:switch', workspaceId);
}

export async function renameLocalWorkspace(workspaceId, name) {
  return backend.invoke('workspace:rename', { id: workspaceId, name });
}
