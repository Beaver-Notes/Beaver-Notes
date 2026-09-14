import { reactive, ref, computed } from 'vue';
import { useNoteStore } from '@/store/note';
import { useFolderStore } from '@/store/folder';
import { useUndoStore } from '@/store/undo';
import { parseItemId } from '@/utils/helpers/index.js';

let _instance = null;

export function useSelectionBar() {
  if (_instance) return _instance;

  const selectedKeys = ref(new Set());
  let clearFn = null;
  let deleteFn = null;
  let moveFn = null;
  let customizeFn = null;

  const noteStore = useNoteStore();
  const folderStore = useFolderStore();

  const hasSelection = computed(() => selectedKeys.value.size > 0);
  const selectedCount = computed(() => selectedKeys.value.size);

  const _selectedParsed = computed(() => {
    const notes = [];
    const folders = [];
    for (const key of selectedKeys.value) {
      const { type, id } = parseItemId(key);
      if (type === 'note' && id) {
        const note = noteStore.getById(id);
        if (note) notes.push(note);
      } else if (type === 'folder' && id) {
        const folder = folderStore.data[id];
        if (folder) folders.push(folder);
      }
    }
    return { notes, folders };
  });

  const selectedNotes = computed(() => _selectedParsed.value.notes);
  const hasSelectedNotes = computed(() => _selectedParsed.value.notes.length > 0);
  const selectedFolders = computed(() => _selectedParsed.value.folders);
  const hasSelectedFolders = computed(() => _selectedParsed.value.folders.length > 0);

  const shouldArchive = computed(() => {
    const notes = selectedNotes.value;
    const folders = selectedFolders.value;
    if (!notes.length && !folders.length) return true;

    let archivedCount = 0;
    let totalCount = 0;

    for (const n of notes) {
      totalCount++;
      if (n.isArchived) archivedCount++;
    }
    for (const f of folders) {
      totalCount++;
      if (f.isArchived) archivedCount++;
    }

    return archivedCount < totalCount / 2;
  });

  const shouldBookmark = computed(() => {
    const notes = selectedNotes.value;
    if (!notes.length) return true;
    const bookmarkedCount = notes.filter((n) => n.isBookmarked).length;
    return bookmarkedCount < notes.length / 2;
  });

  const shouldLock = computed(() => {
    const notes = selectedNotes.value;
    if (!notes.length) return true;
    const lockedCount = notes.filter((n) => n.isLocked).length;
    return lockedCount < notes.length / 2;
  });

  const showCustomize = computed(() => selectedFolders.value.length === 1 && selectedNotes.value.length === 0);

  function syncSelection(items, handlers = {}) {
    selectedKeys.value = items;
    if (handlers.onClear) clearFn = handlers.onClear;
    if (handlers.onDelete) deleteFn = handlers.onDelete;
    if (handlers.onMove) moveFn = handlers.onMove;
    if (handlers.onCustomize) customizeFn = handlers.onCustomize;
  }

  function clearSelection() {
    clearFn?.();
  }

  function deleteSelection() {
    if (!deleteFn) return false;
    deleteFn();
    return true;
  }

  function moveSelection() {
    if (!moveFn) return false;
    moveFn();
    return true;
  }

  function customizeSelection() {
    if (!customizeFn) return false;
    const id = selectedFolders.value[0]?.id;
    if (!id) return false;
    customizeFn(id);
    return true;
  }

  async function toggleArchive() {
    const archive = shouldArchive.value;

    const undoStore = useUndoStore();
    undoStore.startBatch();

    for (const note of selectedNotes.value) {
      await noteStore.update(note.id, { isArchived: archive });
    }

    for (const folder of selectedFolders.value) {
      if (archive) {
        await folderStore.archive(folder.id);
      } else {
        await folderStore.unarchive(folder.id);
      }
    }

    undoStore.commitBatch();
    clearSelection();
  }

  async function toggleLock() {
    const shouldLockNotes = shouldLock.value;

    try {
      if (shouldLockNotes) {
        for (const note of selectedNotes.value) {
          if (!note.isLocked) {
            await noteStore.lockNote(note.id);
          }
        }
      } else {
        for (const note of selectedNotes.value) {
          if (note.isLocked) {
            await noteStore.unlockNote(note.id);
          }
        }
      }
      clearSelection();
    } catch (err) {
      console.error('Failed to toggle lock:', err);
    }
  }

  async function toggleBookmark() {
    const bookmark = shouldBookmark.value;

    const undoStore = useUndoStore();
    undoStore.startBatch();

    for (const note of selectedNotes.value) {
      await noteStore.update(note.id, { isBookmarked: bookmark });
    }

    undoStore.commitBatch();
    clearSelection();
  }

  _instance = reactive({
    selectedKeys,
    hasSelection,
    selectedCount,
    selectedNotes,
    hasSelectedNotes,
    selectedFolders,
    hasSelectedFolders,
    shouldArchive,
    shouldBookmark,
    shouldLock,
    showCustomize,
    syncSelection,
    clearSelection,
    deleteSelection,
    moveSelection,
    customizeSelection,
    toggleArchive,
    toggleLock,
    toggleBookmark,
  });

  return _instance;
}
