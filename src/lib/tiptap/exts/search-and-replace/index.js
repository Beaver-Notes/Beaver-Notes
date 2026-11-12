/**
 * Local fork of `@sereneinserenade/tiptap-search-and-replace` (MIT, © 2023-2024
 * Jeet Mandaliya), fixed for large documents. Upstream rebuilt the ENTIRE
 * document's decorations on every doc-changing transaction (every keystroke
 * while a term is set) and again on every resultIndex change (next/prev) —
 * a full descendants walk + regex over all text + DecorationSet.create each
 * time, which made search unusable on multi-thousand-block notes.
 *
 * Fork behavior:
 * - Term/flag change: one full scan (necessary).
 * - Doc change while a term is set: map the existing DecorationSet and result
 *   ranges through the transaction, then schedule ONE idle rescan (400ms,
 *   cleared on every subsequent apply) to catch newly typed matches.
 * - resultIndex change: no rescan. The "current result" highlight is a
 *   separate single-decoration overlay plugin, so next/prev costs ~nothing.
 * - replace() targets the CURRENT result (upstream always replaced the first).
 * - Decorations are capped (RESULT_DECORATION_CAP) to bound DecorationSet
 *   cost; `results` keeps every match so navigation and replaceAll stay exact.
 */
import { Extension } from '@tiptap/core';
import { DecorationSet, Decoration } from '@tiptap/pm/view';
import { PluginKey, Plugin } from '@tiptap/pm/state';

const BASE_KEY = new PluginKey('searchAndReplace');
const OVERLAY_KEY = new PluginKey('searchAndReplaceOverlay');
const RESCAN_IDLE_MS = 400;
const RESULT_DECORATION_CAP = 2000;

const getRegex = (s, disableRegex, caseSensitive) =>
  RegExp(
    disableRegex ? s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : s,
    caseSensitive ? 'gu' : 'gui',
  );

function processSearches(doc, searchTerm, searchResultClass) {
  if (!searchTerm) return { decorations: DecorationSet.empty, results: [] };

  const results = [];
  let textNodesWithPosition = [];
  let index = 0;
  doc?.descendants((node, pos) => {
    if (node.isText) {
      if (textNodesWithPosition[index]) {
        textNodesWithPosition[index] = {
          text: textNodesWithPosition[index].text + node.text,
          pos: textNodesWithPosition[index].pos,
        };
      } else {
        textNodesWithPosition[index] = { text: `${node.text}`, pos };
      }
    } else {
      index += 1;
    }
  });
  textNodesWithPosition = textNodesWithPosition.filter(Boolean);

  for (const element of textNodesWithPosition) {
    const { text, pos } = element;
    const matches = Array.from(text.matchAll(searchTerm)).filter(
      ([matchText]) => matchText.trim(),
    );
    for (const m of matches) {
      if (m[0] === '') break;
      if (m.index !== undefined) {
        results.push({ from: pos + m.index, to: pos + m.index + m[0].length });
      }
    }
  }

  // Decorations are capped; results are not — navigation and replaceAll see
  // every match even when highlighting stops at the cap.
  const cap = Math.min(results.length, RESULT_DECORATION_CAP);
  const decorations = [];
  for (let i = 0; i < cap; i += 1) {
    const r = results[i];
    decorations[i] = Decoration.inline(r.from, r.to, { class: searchResultClass });
  }
  return { decorations: DecorationSet.create(doc, decorations), results };
}

/** Map result ranges through a transaction; drop ranges that were deleted. */
function mapResults(results, tr) {
  const mapping = tr.mapping;
  const mapped = [];
  for (const r of results) {
    const from = mapping.map(r.from, -1);
    const to = mapping.map(r.to, 1);
    if (to > from) mapped.push({ from, to });
  }
  return mapped;
}

const replace = (replaceTerm, result, { state, dispatch }) => {
  if (!result) return;
  if (dispatch) {
    dispatch(state.tr.insertText(replaceTerm, result.from, result.to));
  }
};

const rebaseNextResult = (replaceTerm, index, lastOffset, results) => {
  const nextIndex = index + 1;
  if (!results[nextIndex]) return null;
  const { from: currentFrom, to: currentTo } = results[index];
  const offset = currentTo - currentFrom - replaceTerm.length + lastOffset;
  const { from, to } = results[nextIndex];
  results[nextIndex] = { to: to - offset, from: from - offset };
  return [offset, results];
};

const replaceAll = (replaceTerm, results, { tr, dispatch }) => {
  let offset = 0;
  const resultsCopy = results.slice();
  if (!resultsCopy.length) return;
  for (let i = 0; i < resultsCopy.length; i += 1) {
    const { from, to } = resultsCopy[i];
    tr.insertText(replaceTerm, from, to);
    const rebase = rebaseNextResult(replaceTerm, i, offset, resultsCopy);
    if (!rebase) continue;
    offset = rebase[0];
  }
  dispatch(tr);
};

const SearchAndReplace = Extension.create({
  name: 'searchAndReplace',
  addOptions() {
    return {
      searchResultClass: 'search-result',
      disableRegex: true,
    };
  },
  addStorage() {
    return {
      searchTerm: '',
      replaceTerm: '',
      results: [],
      caseSensitive: false,
      resultIndex: 0,
    };
  },
  addCommands() {
    return {
      setSearchTerm:
        (searchTerm) =>
        ({ editor }) => {
          editor.storage.searchAndReplace.searchTerm = searchTerm;
          return false;
        },
      setReplaceTerm:
        (replaceTerm) =>
        ({ editor }) => {
          editor.storage.searchAndReplace.replaceTerm = replaceTerm;
          return false;
        },
      setCaseSensitive:
        (caseSensitive) =>
        ({ editor }) => {
          editor.storage.searchAndReplace.caseSensitive = caseSensitive;
          return false;
        },
      resetIndex:
        () =>
        ({ editor }) => {
          editor.storage.searchAndReplace.resultIndex = 0;
          return false;
        },
      nextSearchResult:
        () =>
        ({ editor }) => {
          const { results, resultIndex } = editor.storage.searchAndReplace;
          const nextIndex = resultIndex + 1;
          editor.storage.searchAndReplace.resultIndex = results[nextIndex]
            ? nextIndex
            : 0;
          return false;
        },
      previousSearchResult:
        () =>
        ({ editor }) => {
          const { results, resultIndex } = editor.storage.searchAndReplace;
          const prevIndex = resultIndex - 1;
          editor.storage.searchAndReplace.resultIndex =
            prevIndex >= 0 ? prevIndex : results.length - 1;
          return false;
        },
      replace:
        () =>
        ({ editor, state, dispatch }) => {
          const { replaceTerm, results, resultIndex } =
            editor.storage.searchAndReplace;
          // Upstream replaced results[0] regardless of the selected match.
          replace(replaceTerm, results[resultIndex], { state, dispatch });
          return false;
        },
      replaceAll:
        () =>
        ({ editor, tr, dispatch }) => {
          const { replaceTerm, results } = editor.storage.searchAndReplace;
          replaceAll(replaceTerm, results, { tr, dispatch });
          return false;
        },
    };
  },
  addProseMirrorPlugins() {
    const editor = this.editor;
    const { searchResultClass, disableRegex } = this.options;
    let idleRescanTimer = 0;

    const clearIdleRescan = () => {
      if (idleRescanTimer) {
        clearTimeout(idleRescanTimer);
        idleRescanTimer = 0;
      }
    };

    const buildBase = (doc) => {
      const storage = editor.storage.searchAndReplace;
      const { decorations, results } = processSearches(
        doc,
        getRegex(storage.searchTerm, disableRegex, storage.caseSensitive),
        searchResultClass,
      );
      storage.results = results;
      return decorations;
    };

    // Base plugin: all matches. Full scan only on term/flag change or an
    // explicit idle rescan; doc changes map the existing set.
    const basePlugin = new Plugin({
      key: BASE_KEY,
      state: {
        init: () => DecorationSet.empty,
        apply(tr, prev) {
          const storage = editor.storage.searchAndReplace;
          const term = storage.searchTerm;
          const termChanged =
            term !== basePlugin.lastTerm ||
            storage.caseSensitive !== basePlugin.lastCase;
          basePlugin.lastTerm = term;
          basePlugin.lastCase = storage.caseSensitive;
          const rescanRequested = Boolean(tr.getMeta(BASE_KEY)?.rescan);

          if (!term) {
            clearIdleRescan();
            storage.results = [];
            return DecorationSet.empty;
          }

          if (termChanged || rescanRequested) {
            const set = buildBase(tr.doc);
            clearIdleRescan();
            return set;
          }

          if (tr.docChanged) {
            // Map the previous set through the transaction, then schedule one
            // idle rescan to catch matches introduced by this edit.
            if (idleRescanTimer) clearTimeout(idleRescanTimer);
            idleRescanTimer = setTimeout(() => {
              idleRescanTimer = 0;
              if (editor.isDestroyed) return;
              editor.view.dispatch(editor.state.tr.setMeta(BASE_KEY, { rescan: true }));
            }, RESCAN_IDLE_MS);
            storage.results = mapResults(storage.results, tr);
            return prev.map(tr.mapping, tr.doc);
          }

          return prev;
        },
      },
      props: {
        decorations(state) {
          return this.getState(state);
        },
      },
      view() {
        return {
          destroy: clearIdleRescan,
        };
      },
    });

    // Overlay plugin: exactly one decoration for the current result, so
    // next/prev navigation never rebuilds the base set.
    const overlayPlugin = new Plugin({
      key: OVERLAY_KEY,
      state: {
        init: () => DecorationSet.empty,
        apply(tr, prev) {
          const storage = editor.storage.searchAndReplace;
          const r = storage.results?.[storage.resultIndex];
          const changed =
            tr.docChanged ||
            !r ||
            !overlayPlugin.lastRange ||
            overlayPlugin.lastRange.from !== r.from ||
            overlayPlugin.lastRange.to !== r.to;
          if (!r) {
            overlayPlugin.lastRange = null;
            return DecorationSet.empty;
          }
          if (!changed) return prev;
          overlayPlugin.lastRange = { from: r.from, to: r.to };
          try {
            return DecorationSet.create(tr.doc, [
              Decoration.inline(r.from, r.to, { class: 'search-result-current' }),
            ]);
          } catch {
            return DecorationSet.empty;
          }
        },
      },
      props: {
        decorations(state) {
          return this.getState(state);
        },
      },
    });

    return [basePlugin, overlayPlugin];
  },
});

export default SearchAndReplace;
export { SearchAndReplace, BASE_KEY as searchAndReplacePluginKey, OVERLAY_KEY };
