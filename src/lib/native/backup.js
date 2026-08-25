import { backend } from '@/lib/tauri-bridge';

// Full-state backup folders (data.db + settings.db + assets/).
export function exportBackup(dir) {
  return backend.invoke('backup:export', { dir });
}

export function importBackup(dir) {
  return backend.invoke('backup:import', { dir });
}
