import { watch } from 'vue';
import { invokeCommand } from '@/lib/tauri/commands';
import { useFolderStore } from '@/store/folder';
import { useNoteStore } from '@/store/note';
import { useWorkspaceStore } from '@/store/workspace';

export function useShareExtensionSync() {
  const folderStore = useFolderStore();
  const noteStore = useNoteStore();
  const workspaceStore = useWorkspaceStore();

  // Freshness marker for the sheet Where footer (App Group key
  // shareListsUpdatedAt, read by AppGroupBridge.listsFooter). Folders + notes
  // only — workspaces are display-only context.
  const touchListsTimestamp = () => {
    // Both key variants: the running binary may predate the current
    // `updated_at` param name (it demanded `updatedAt`). Tauri ignores
    // unknown args, so exactly one lands on either revision.
    const now = Date.now();
    void invokeCommand('sync_extension_lists_timestamp', { updated_at: now, updatedAt: now });
  };

  watch(
    () => Object.values(folderStore.data)
      .filter((f) => !f.parentId && !f.isArchived)
      .map((f) => ({ id: f.id, name: f.name, icon: f.icon })),
    (folders) => { void invokeCommand('sync_folders_to_extension', { folders }); touchListsTimestamp(); },
    { immediate: true, deep: false }
  );

  watch(
    () => workspaceStore.workspaces.map((w) => ({ id: w.id, name: w.name })),
    (workspaces) => { void invokeCommand('sync_workspaces_to_extension', { workspaces }); },
    { immediate: true, deep: false }
  );

  watch(
    () => Object.values(noteStore.data || {})
      .filter((n) => !n.isArchived)
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
      .slice(0, 50)
      .map((n) => ({ id: n.id, title: n.title || '', updatedAt: n.updatedAt || 0, updated_at: n.updatedAt || 0 })),
    (notes) => { void invokeCommand('sync_notes_to_extension', { notes }); touchListsTimestamp(); },
    { immediate: true, deep: false }
  );
}
