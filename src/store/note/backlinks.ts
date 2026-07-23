// Reverse index of note links: targetNoteId -> Set<sourceNoteId>.
// Maintained incrementally on note save/delete to keep backlinks O(1).

interface LinkContent {
  type?: string;
  attrs?: Record<string, unknown>;
  marks?: { type: string; attrs?: { href?: string } }[];
  content?: LinkContent[];
}

export const linkIndex: Record<string, Set<string>> = {};

// Forward index: sourceNoteId -> Set<targetNoteId>.
// Used by rebuildLinkIndexForNote to find old outgoing targets in O(1)
// instead of scanning the entire reverse index.
const outgoingIndex: Record<string, Set<string>> = {};

export function extractLinkNoteTargets(content: LinkContent | null | undefined): string[] {
  if (!content) return [];
  const ids = new Set<string>();
  const walk = (node: LinkContent | null | undefined) => {
    if (!node) return;

    if (node.type === 'linkNote' && node.attrs?.id) {
      ids.add(node.attrs.id as string);
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

function getSources(targetId: string): Set<string> {
  if (!linkIndex[targetId]) linkIndex[targetId] = new Set();
  return linkIndex[targetId];
}

// Recompute this note's outgoing links and update the index.
export function rebuildLinkIndexForNote(noteId: string, content: LinkContent | null | undefined): void {
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

export function removeNoteFromLinkIndex(noteId: string): void {
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

export function rebuildLinkIndexFromAll(notesData: Record<string, { id?: string; content?: LinkContent }> | null | undefined): void {
  for (const key of Object.keys(linkIndex)) delete linkIndex[key];
  for (const key of Object.keys(outgoingIndex)) delete outgoingIndex[key];
  if (!notesData) return;
  for (const note of Object.values(notesData)) {
    if (note?.id) rebuildLinkIndexForNote(note.id, note.content);
  }
}

// Pinia getter: (noteId) => Note[]  (sources that link to noteId)
import type { NoteData } from './index';

export function getBacklinks(state: { data: Record<string, NoteData> }) {
  return (noteId: string) => {
    const sources = linkIndex[noteId];
    if (!sources) return [];
    return [...sources].map((id) => state.data[id]).filter(Boolean);
  };
}

export function getBacklinkCount(_state: { data: Record<string, NoteData> }) {
  return (noteId: string): number => linkIndex[noteId]?.size ?? 0;
}
