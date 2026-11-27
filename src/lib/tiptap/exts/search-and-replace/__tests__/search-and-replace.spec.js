import { afterEach, describe, expect, it, vi } from 'vitest';
import { Editor } from '@tiptap/core';
import Document from '@tiptap/extension-document';
import Paragraph from '@tiptap/extension-paragraph';
import Text from '@tiptap/extension-text';
import SearchAndReplace, {
  searchAndReplacePluginKey,
  OVERLAY_KEY,
} from '../index.js';

const editors = [];

function makeEditor(content) {
  const editor = new Editor({
    content,
    extensions: [Document, Paragraph, Text, SearchAndReplace.configure()],
    enableCoreExtensions: { paste: false, textDirection: false },
  });
  editors.push(editor);
  return editor;
}

afterEach(() => {
  while (editors.length) editors.pop().destroy();
});

/** All decoration ranges currently rendered by the search plugins. */
function decoratedRanges(editor) {
  const base = searchAndReplacePluginKey.getState(editor.state);
  const overlay = OVERLAY_KEY.getState(editor.state);
  const specs = [];
  for (const d of base?.find?.() || []) {
    specs.push({ from: d.from, to: d.to, class: d.type?.attrs?.class || '' });
  }
  for (const d of overlay?.find?.() || []) {
    specs.push({ from: d.from, to: d.to, class: d.type?.attrs?.class || '' });
  }
  return specs;
}

function flush(editor) {
  // Any selection-only transaction pushes plugin state (storage writes alone
  // do not flow through apply()).
  editor.commands.setTextSelection(0);
}

describe('search-and-replace fork (large-doc safe)', () => {
  it('finds all matches and highlights the current one', () => {
    const editor = makeEditor('<p>cat dog cat</p>');
    editor.commands.setSearchTerm('cat');
    flush(editor);

    expect(editor.storage.searchAndReplace.results).toHaveLength(2);
    const ranges = decoratedRanges(editor);
    expect(ranges.filter((r) => r.class === 'search-result')).toHaveLength(2);
    expect(ranges.filter((r) => r.class === 'search-result-current')).toHaveLength(1);
  });

  it('maps decorations through edits before the idle rescan fires', () => {
    const editor = makeEditor('<p>alpha beta</p>');
    editor.commands.setSearchTerm('beta');
    flush(editor);
    expect(editor.storage.searchAndReplace.results).toHaveLength(1);

    // Insert text BEFORE the match: its position shifts. Until the idle
    // rescan, results/decorations must be the MAPPED ranges, not stale ones.
    editor.commands.insertContentAt(1, 'X');
    const text = editor.state.doc.textBetween(
      0,
      editor.state.doc.content.size,
      '\n',
    );
    const betaAt = text.indexOf('beta');
    expect(betaAt).toBeGreaterThan(0);

    const results = editor.storage.searchAndReplace.results;
    expect(results).toHaveLength(1);
    expect(results[0].from).toBeGreaterThan(6); // shifted right by the insert

    const base = decoratedRanges(editor).find((r) => r.class === 'search-result');
    expect(base.from).toBe(results[0].from);
    expect(base.to).toBe(results[0].to);
  });

  it('rescans once on idle and catches newly typed matches', async () => {
    vi.useFakeTimers();
    try {
      const editor = makeEditor('<p>alpha</p>');
      editor.commands.setSearchTerm('needle');
      flush(editor);
      expect(editor.storage.searchAndReplace.results).toHaveLength(0);

      editor.commands.insertContentAt(1, ' needle');
      expect(editor.storage.searchAndReplace.results).toHaveLength(0);

      await vi.advanceTimersByTimeAsync(450);
      expect(editor.storage.searchAndReplace.results).toHaveLength(1);

      // No further scan churn after settling.
      const snapshot = editor.storage.searchAndReplace.results;
      await vi.advanceTimersByTimeAsync(1000);
      expect(editor.storage.searchAndReplace.results).toBe(snapshot);
    } finally {
      vi.useRealTimers();
    }
  });

  it('next/prev navigation never rescans (results identity unchanged)', () => {
    const editor = makeEditor('<p>a b a b a</p>');
    editor.commands.setSearchTerm('b');
    flush(editor);
    const storage = editor.storage.searchAndReplace;
    const snapshot = storage.results;
    expect(storage.results).toHaveLength(2);

    editor.commands.nextSearchResult();
    expect(storage.results).toBe(snapshot);
    expect(storage.resultIndex).toBe(1);

    // Second next wraps around (only two matches).
    editor.commands.nextSearchResult();
    expect(storage.results).toBe(snapshot);
    expect(storage.resultIndex).toBe(0);

    editor.commands.previousSearchResult();
    expect(storage.resultIndex).toBe(1);
    const current = decoratedRanges(editor).find(
      (r) => r.class === 'search-result-current',
    );
    expect(current.from).toBe(storage.results[1].from);
  });

  it('replace targets the current result, not the first', () => {
    const editor = makeEditor('<p>cat cat</p>');
    editor.commands.setSearchTerm('cat');
    editor.commands.setReplaceTerm('XX');
    flush(editor);
    editor.storage.searchAndReplace.resultIndex = 1;

    editor.commands.replace();
    expect(editor.state.doc.textContent).toBe('cat XX');
  });

  it('replaceAll replaces every match in one transaction', () => {
    const editor = makeEditor('<p>cat dog cat dog cat</p>');
    editor.commands.setSearchTerm('cat');
    editor.commands.setReplaceTerm('fish');
    flush(editor);
    editor.commands.replaceAll();

    expect(editor.state.doc.textContent).toBe('fish dog fish dog fish');
  });

  it('clearing the term drops all decorations and results', () => {
    const editor = makeEditor('<p>cat cat</p>');
    editor.commands.setSearchTerm('cat');
    flush(editor);
    expect(editor.storage.searchAndReplace.results).toHaveLength(2);

    editor.commands.setSearchTerm('');
    flush(editor);
    expect(editor.storage.searchAndReplace.results).toHaveLength(0);
    expect(decoratedRanges(editor)).toHaveLength(0);
  });
});
