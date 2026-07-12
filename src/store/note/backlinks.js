// Reverse index of note links: targetNoteId -> Set<sourceNoteId>.
// Maintained incrementally on note save/delete to keep backlinks O(1).

export const linkIndex = {};

// Forward index: sourceNoteId -> Set<targetNoteId>.
// Used by rebuildLinkIndexForNote to find old outgoing targets in O(1)
// instead of scanning the entire reverse index.
const outgoingIndex = {};

export function extractLinkNoteTargets(content) {
  if (!content) return [];
  const ids = new Set();
  const walk = (node) => {
    if (!node) return;

    if (node.type === 'linkNote' && node.attrs?.id) {
      ids.add(node.attrs.id);
    }

    if (node.marks) {
      for (const mark of node.marks) {
        if (mark.type === 'link' && mark.attrs?.href?.startsWith('note://')) {
          ids.add(mark.attrs.href.slice('note://'.length));
        }
      }
    }

    if (Array.isArray(node.content)) {
      for (const child of node.content) walk(child);
    }
  };
  walk(content);
  return [...ids];
}

function getSources(targetId) {
  if (!linkIndex[targetId]) linkIndex[targetId] = new Set();
  return linkIndex[targetId];
}

// Recompute this note's outgoing links and update the index.
export function rebuildLinkIndexForNote(noteId, content) {
  if (!noteId) return;

  const newTargets = new Set(extractLinkNoteTargets(content));
  const oldTargets = outgoingIndex[noteId] || new Set();

  for (const target of oldTargets) {
    if (!newTargets.has(target)) {
      linkIndex[target]?.delete(noteId);
      if (linkIndex[target]?.size === 0) delete linkIndex[target];
    }
  }

  for (const target of newTargets) {
    getSources(target).add(noteId);
  }

  outgoingIndex[noteId] = newTargets;
}

export function removeNoteFromLinkIndex(noteId) {
  if (!noteId) return;
  const targets = outgoingIndex[noteId];
  if (targets) {
    for (const target of targets) {
      linkIndex[target]?.delete(noteId);
      if (linkIndex[target]?.size === 0) delete linkIndex[target];
    }
    delete outgoingIndex[noteId];
  }
}

export function rebuildLinkIndexFromAll(notesData) {
  for (const key of Object.keys(linkIndex)) delete linkIndex[key];
  for (const key of Object.keys(outgoingIndex)) delete outgoingIndex[key];
  if (!notesData) return;
  for (const note of Object.values(notesData)) {
    if (note?.id) rebuildLinkIndexForNote(note.id, note.content);
  }
}

// Pinia getter: (noteId) => Note[]  (sources that link to noteId)
export function getBacklinks(state) {
  return (noteId) => {
    const sources = linkIndex[noteId];
    if (!sources) return [];
    return [...sources].map((id) => state.data[id]).filter(Boolean);
  };
}

export function getBacklinkCount(_state) {
  return (noteId) => linkIndex[noteId]?.size ?? 0;
}
