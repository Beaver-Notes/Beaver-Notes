import { describe, it, expect } from 'vitest';
import { ref, nextTick } from 'vue';
import { useNoteMove } from '../useNoteMove.js';

describe('useNoteMove', () => {
  it('opens the modal with the target note', () => {
    const showMoveModal = ref(false);
    const { moveTarget, openMoveForNote } = useNoteMove(showMoveModal);
    const note = { id: 'n1' };
    openMoveForNote(note);
    expect(showMoveModal.value).toBe(true);
    expect(moveTarget.value.id).toBe(note.id);
    expect(moveTarget.value).toStrictEqual(note);
  });

  it('clears the target after a successful single move', async () => {
    const showMoveModal = ref(true);
    const { moveTarget, handleSingleMoved } = useNoteMove(showMoveModal);
    moveTarget.value = { id: 'n1' };
    handleSingleMoved();
    await nextTick();
    expect(moveTarget.value).toBe(null);
    expect(showMoveModal.value).toBe(false);
  });

  it('clears the target when the modal closes without a move (cancel/backdrop)', async () => {
    const showMoveModal = ref(true);
    const { moveTarget } = useNoteMove(showMoveModal);
    moveTarget.value = { id: 'n1' };
    showMoveModal.value = false;
    await nextTick();
    expect(moveTarget.value).toBe(null);
  });
});
