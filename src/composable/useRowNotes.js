import { computed, ref, unref } from 'vue';
import { useRouter } from 'vue-router';
import { useDialog } from '@/lib/dialog';
import { useNoteStore } from '@/store/note';
import { useTranslations } from './useTranslations';
import {
  ensureBackingNote,
  backingNoteIdOf,
  rowTitleText,
} from '@/lib/database/row-notes';

// Lazy note-backing wiring shared by /db/:id and the embedded
// DatabaseSurface. `db` is the caller's existing useDatabaseYjs instance —
// never call useDatabaseYjs twice for the same database.
export function useRowNotes(schema, db) {
  const router = useRouter();
  const dialog = useDialog();
  const noteStore = useNoteStore();
  const { translations } = useTranslations();
  const t = computed(() => translations.value.database || {});

  const openRowId = ref(null);
  const detailRow = computed(() => {
    if (!openRowId.value) return null;
    void db.version?.value;
    return db.getRow(openRowId.value);
  });

  function openRow(rowId) {
    openRowId.value = rowId;
  }
  function closeRow() {
    openRowId.value = null;
  }

  // One materialization per row at a time: a second click while `add()` is
  // still awaiting must not mint a duplicate backing note.
  const pendingOpens = new Set();

  async function openRowPage(rowId) {
    if (pendingOpens.has(rowId)) return;
    pendingOpens.add(rowId);
    try {
      let row = db.getRow(rowId);
      if (!row) return closeRow();
      // Stale id (note deleted directly or orphaned by sync): clear it so a
      // fresh page is materialized instead of navigating to a dead id forever.
      if (row.noteId && !noteStore.getById(row.noteId)) {
        db.setRowNoteId(rowId, null);
        row = db.getRow(rowId);
      }
      const noteId = await ensureBackingNote({
        row,
        title: rowTitleText(unref(schema), row),
        createNote: async (title) => {
          // Ordinary note: normal id, searchable, backed up; only the
          // inDatabase flag keeps it out of sidebar/notes lists.
          const note = await noteStore.add({ title, inDatabase: true });
          db.setRowNoteId(rowId, note.id);
          return note.id;
        },
      });
      closeRow();
      router.push(`/note/${noteId}`);
    } catch (err) {
      console.warn('[database] could not materialize backing note:', err);
    } finally {
      pendingOpens.delete(rowId);
    }
  }

  function removeRow(rowId) {
    dialog.confirm({
      title: t.value.deleteRowConfirmTitle || 'Delete this row?',
      body:
        t.value.deleteRowConfirmBody ||
        'The row and its backing page will be permanently deleted.',
      icon: 'riDeleteBin6Line',
      okVariant: 'danger',
      onConfirm: async () => {
        // Deleting a row cascades to its backing note when one was materialized.
        try {
          const noteId = backingNoteIdOf(db.getRow(rowId));
          db.deleteRow(rowId);
          if (noteId && noteStore.getById(noteId)) await noteStore.delete(noteId);
        } catch (err) {
          console.error('[database] could not cascade-delete backing note:', err);
        } finally {
          closeRow();
        }
      },
    });
  }

  function onDetailUpdate({ rowId, patch }) {
    db.updateCells(rowId, patch);
  }

  return { openRowId, detailRow, openRow, closeRow, openRowPage, removeRow, onDetailUpdate };
}
