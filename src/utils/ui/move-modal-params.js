export function resolveMoveModalParams(moveTarget, selectedNotes, selectedFolders, moveMode) {
  if (moveTarget) {
    return { notes: [moveTarget], folders: [], mode: 'note' };
  }
  const hasNotes = selectedNotes.length > 0;
  const hasFolders = selectedFolders.length > 0;
  if (hasNotes && hasFolders) return { notes: selectedNotes, folders: selectedFolders, mode: 'mixed' };
  return { notes: selectedNotes, folders: selectedFolders, mode: moveMode };
}
