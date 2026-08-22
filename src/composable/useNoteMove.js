import { ref, watch } from 'vue';

/**
 * Single-note move-to-folder state for the page-level FolderTree modal.
 * The card emits `move`; the page opens the modal with that note. FolderTree
 * itself applies the move and emits `moved`; this composable only owns the
 * state transitions and resets `moveTarget` whenever the modal closes without
 * a move (cancel/backdrop).
 */
export function useNoteMove(showMoveModal) {
  const moveTarget = ref(null);

  function openMoveForNote(note) {
    moveTarget.value = note;
    showMoveModal.value = true;
  }

  function handleSingleMoved() {
    moveTarget.value = null;
    showMoveModal.value = false;
  }

  watch(showMoveModal, (open) => {
    if (!open) moveTarget.value = null;
  });

  return { moveTarget, openMoveForNote, handleSingleMoved };
}
