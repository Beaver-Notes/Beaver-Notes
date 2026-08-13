import { backend } from '@/lib/tauri-bridge';

export async function listLocalWorkspaces() {
  return backend.invoke('workspace:list');
}

export async function deleteLocalWorkspace(workspaceId) {
  return backend.invoke('workspace:delete', workspaceId);
}
