import { ref, computed } from 'vue';
import { useNoteStore } from '@/store/note';
import { parseItemId } from '@/utils/helper';

const _selectedKeys = ref(new Set());

let _clearFn = null;
let _deleteFn = null;
let _moveFn = null;

export function useSelectionBar() {
  const noteStore = useNoteStore();

  const hasSelection = computed(() => _selectedKeys.value.size > 0);
  const selectedCount = computed(() => _selectedKeys.value.size);

  const selectedNotes = computed(() =>
    Array.from(_selectedKeys.value)
      .map(parseItemId)
      .filter(({ type, id }) => type === 'note' && id)
      .map(({ id }) => noteStore.getById(id))
      .filter(Boolean)
  );

  const hasSelectedNotes = computed(() => selectedNotes.value.length > 0);

  const shouldArchive = computed(() => {
    const notes = selectedNotes.value;
    if (!notes.length) return true;
    const archivedCount = notes.filter((n) => n.isArchived).length;
    return archivedCount < notes.length / 2;
  });

  const shouldBookmark = computed(() => {
    const notes = selectedNotes.value;
    if (!notes.length) return true;
    const bookmarkedCount = notes.filter((n) => n.isBookmarked).length;
    return bookmarkedCount < notes.length / 2;
  });

  function syncSelection(items, handlers = {}) {
    _selectedKeys.value = items;
    if (handlers.onClear) _clearFn = handlers.onClear;
    if (handlers.onDelete) _deleteFn = handlers.onDelete;
    if (handlers.onMove) _moveFn = handlers.onMove;
  }

  function clearSelection() {
    _clearFn?.();
  }

  function deleteSelection() {
    _deleteFn?.();
  }

  function moveSelection() {
    _moveFn?.();
  }

  async function toggleArchive() {
    const archive = shouldArchive.value;
    for (const note of selectedNotes.value) {
      await noteStore.update(note.id, { isArchived: archive });
    }
    clearSelection();
  }

  async function toggleBookmark() {
    const bookmark = shouldBookmark.value;
    for (const note of selectedNotes.value) {
      await noteStore.update(note.id, { isBookmarked: bookmark });
    }
    clearSelection();
  }

  return {
    hasSelection,
    selectedCount,
    selectedNotes,
    hasSelectedNotes,
    shouldArchive,
    shouldBookmark,
    syncSelection,
    clearSelection,
    deleteSelection,
    moveSelection,
    toggleArchive,
    toggleBookmark,
  };
}
