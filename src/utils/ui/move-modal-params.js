export function resolveMoveModalParams(moveTarget, selectedNotes, selectedFolders, moveMode) {
  if (moveTarget) {
    return { notes: [moveTarget], folders: [], mode: 'note' };
  }
  return { notes: selectedNotes, folders: selectedFolders, mode: moveMode };
}
