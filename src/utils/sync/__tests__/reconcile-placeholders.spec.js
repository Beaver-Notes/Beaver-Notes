import { describe, expect, it, beforeEach } from 'vitest';
import * as Y from 'yjs';
import { reconcileUnknownNotePlaceholders } from '@/lib/yjs/workspace-doc';
import { getWorkspaceDoc, destroyWorkspaceDoc } from '@/lib/yjs/meta-doc';
import { syncNoteMeta } from '@/lib/yjs/workspace-doc';

describe('reconcileUnknownNotePlaceholders', () => {
  beforeEach(() => {
    destroyWorkspaceDoc();
    // Deterministic LWW tie-breaking: local placeholder writes use clientID 100.
    getWorkspaceDoc().clientID = 100;
  });

  it('creates placeholders only for unknown ids and never turns meta into a note card', () => {
    const yNotes = getWorkspaceDoc().getMap('notes');
    expect(yNotes.has('abc')).toBe(false);
    expect(yNotes.has('meta')).toBe(false);

    reconcileUnknownNotePlaceholders(['meta', 'abc']);

    expect(yNotes.has('abc')).toBe(true);
    expect(yNotes.has('meta')).toBe(false);

    const meta = yNotes.get('abc');
    expect(meta).toBeInstanceOf(Y.Map);
    expect(meta.get('title')).toBe('');
    expect(meta.get('id')).toBe('abc');
    expect(meta.get('folderId')).toBe('');
    expect(meta.get('labels')).toEqual([]);
    expect(meta.get('isArchived')).toBe(false);
    expect(meta.get('preview')).toBe('');
  });

  it('skips ids already present so real titles are not overwritten or re-clocked', () => {
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
    expect(meta.get('labels')).toEqual(['a']);
  });
});
