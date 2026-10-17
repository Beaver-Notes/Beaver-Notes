import { describe, expect, it, beforeEach } from 'vitest';
import { reconcileUnknownNotePlaceholders } from '@/lib/yjs/workspace-doc';
import { getWorkspaceDoc, destroyWorkspaceDoc } from '@/lib/yjs/meta-doc';
import { syncNoteMeta } from '@/lib/yjs/workspace-doc';

// Placeholder synthesis is deliberately disabled: minting `title: ''` entries
// here flashed "Untitled" cards when content arrived a tick before meta.
// Callers hydrate via meta instead, so the reconcile must be a strict no-op.
describe('reconcileUnknownNotePlaceholders', () => {
  beforeEach(() => {
    destroyWorkspaceDoc();
  });

  it('never creates entries for unknown ids (no "Untitled" flash)', () => {
    const yNotes = getWorkspaceDoc().getMap('notes');
    expect(yNotes.has('abc')).toBe(false);
    expect(yNotes.has('meta')).toBe(false);

    reconcileUnknownNotePlaceholders(['meta', 'abc']);

    expect(yNotes.has('abc')).toBe(false);
    expect(yNotes.has('meta')).toBe(false);
    expect(yNotes.size).toBe(0);
  });

  it('leaves existing meta untouched so real titles are not overwritten or re-clocked', () => {
    const yNotes = getWorkspaceDoc().getMap('notes');
    syncNoteMeta({
      id: 'keep',
      title: 'Real Title',
      folderId: 'f1',
      labels: ['a'],
      isArchived: false,
      isLocked: false,
      isBookmarked: false,
      isFullWidth: false,
      createdAt: 1000,
      updatedAt: 1234567890,
      preview: 'snippet',
    });

    reconcileUnknownNotePlaceholders(['keep']);

    const meta = yNotes.get('keep');
    expect(meta.get('title')).toBe('Real Title');
    expect(meta.get('updatedAt')).toBe(1234567890);
    expect(meta.get('folderId')).toBe('f1');
    expect(meta.get('labels').toArray()).toEqual(['a']);
  });
});
