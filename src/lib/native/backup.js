import { backend } from '@/lib/tauri-bridge';

// Full-state backup folders (per-workspace DBs + global assets/). `workspaces`
// lists the workspace ids to include; when omitted the backend exports the
// active workspace only.
export function exportBackup(dir, workspaces) {
  return backend.invoke('backup:export', { dir, workspaces: workspaces ?? null });
}

export function importBackup(dir, vaultKey) {
  // `vaultKey` is only sent for a backup made with a different vault key.
  return backend.invoke('backup:import', vaultKey ? { dir, vaultKey } : { dir });
}
