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
