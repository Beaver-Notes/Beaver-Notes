import { ref, computed } from 'vue';
import { useNoteStore } from '@/store/note';
import { useFolderStore } from '@/store/folder';
import { usePasswordStore } from '@/store/passwd';
import { useDialog } from '@/composable/dialog';
import { useTranslations } from '@/composable/useTranslations';
import { parseItemId } from '@/utils/helper';

const _selectedKeys = ref(new Set());

let _clearFn = null;
let _deleteFn = null;
let _moveFn = null;

export function useSelectionBar() {
  const noteStore = useNoteStore();
  const folderStore = useFolderStore();

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

  const selectedFolders = computed(() =>
    Array.from(_selectedKeys.value)
      .map(parseItemId)
      .filter(({ type, id }) => type === 'folder' && id)
      .map(({ id }) => folderStore.data[id])
      .filter(Boolean)
  );

  const hasSelectedFolders = computed(() => selectedFolders.value.length > 0);

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

    for (const folder of selectedFolders.value) {
      if (archive) {
        await folderStore.archive(folder.id);
      } else {
        await folderStore.unarchive(folder.id);
      }
    }

    clearSelection();
  }

  const shouldLock = computed(() => {
    const notes = selectedNotes.value;
    if (!notes.length) return true;
    const lockedCount = notes.filter((n) => n.isLocked).length;
    return lockedCount < notes.length / 2;
  });

  async function toggleLock() {
    const dialog = useDialog();
    const passwordStore = usePasswordStore();
    const { translations } = useTranslations();
    const t = translations.value;

    const hasSharedKey = await passwordStore.retrieve();

    if (!hasSharedKey) {
      dialog.prompt({
        title: t.card?.enterPasswd || 'Set a password',
        okText: t.card?.setKey || 'Set Key',
        body: t.card?.warning || 'Set a password to lock these notes.',
        cancelText: t.card?.cancel || 'Cancel',
        placeholder: t.card?.password || 'Password',
        onConfirm: async (newKey) => {
          if (!newKey) return;
          try {
            await passwordStore.setSharedKey(newKey);
            for (const note of selectedNotes.value) {
              if (!note.isLocked) {
                await noteStore.lockNote(note.id, newKey);
              }
            }
            clearSelection();
          } catch {
            dialog.alert({
              title: t.settings?.alertTitle || 'Error',
              body: t.card?.keyFail || 'Failed to lock notes.',
              okText: t.dialog?.close || 'Close',
            });
          }
        },
      });
      return;
    }

    const shouldLockNotes = shouldLock.value;

    dialog.prompt({
      title: t.card?.enterPasswd || 'Enter password',
      okText: shouldLockNotes
        ? t.card?.lock || 'Lock'
        : t.card?.unlock || 'Unlock',
      cancelText: t.card?.cancel || 'Cancel',
      placeholder: t.card?.password || 'Password',
      onConfirm: async (password) => {
        const isValid = await passwordStore.isValidPassword(password);
        if (!isValid) {
          dialog.alert({
            title: t.settings?.alertTitle || 'Alert',
            body: t.card?.wrongPasswd || 'Wrong password.',
            okText: t.dialog?.close || 'Close',
          });
          return;
        }

        try {
          if (shouldLockNotes) {
            for (const note of selectedNotes.value) {
              if (!note.isLocked) {
                await noteStore.lockNote(note.id, password);
              }
            }
          } else {
            for (const note of selectedNotes.value) {
              if (note.isLocked) {
                await noteStore.unlockNote(note.id, password);
              }
            }
          }
          clearSelection();
        } catch {
          dialog.alert({
            title: t.settings?.alertTitle || 'Alert',
            body: t.card?.wrongPasswd || 'Wrong password.',
            okText: t.dialog?.close || 'Close',
          });
        }
      },
    });
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
    selectedFolders,
    hasSelectedFolders,
    shouldLock,
    toggleLock,
  };
}
