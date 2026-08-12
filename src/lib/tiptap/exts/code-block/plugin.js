import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

export const codeHighlightPluginKey = new PluginKey('code-highlight');

export function createCodeHighlightPlugin() {
  // Cache the built DecorationSet per plugin-state revision. ProseMirror calls
  // `decorations()` on every view update, which includes frequent non-doc
  // transactions (cursor moves, selection changes, meta-only transactions).
  // Rebuilding a DecorationSet over every token of every highlighted block on
  // each of those was O(total tokens) per transaction even while typing in
  // plain prose. With a revision counter the set is only rebuilt when the
  // token map actually changes (doc edit or re-highlight).
  const decoCache = new WeakMap();

  const plugin = new Plugin({
    key: codeHighlightPluginKey,
    state: {
      init() {
        return { nodeMap: {}, rev: 0 };
      },
      apply(tr, prev) {
        const meta = tr.getMeta(codeHighlightPluginKey);
        if (meta) {
          const nodeMap = { ...prev.nodeMap };
          if (meta.tokens.length === 0) {
            delete nodeMap[meta.nodePos];
          } else {
            nodeMap[meta.nodePos] = meta.tokens;
          }
          return { nodeMap, rev: prev.rev + 1 };
        }
        if (tr.docChanged) {
          const nodeMap = {};
          for (const [pos, tokens] of Object.entries(prev.nodeMap)) {
            const newPos = tr.mapping.map(Number(pos));
            nodeMap[newPos] = tokens;
          }
          return { nodeMap, rev: prev.rev + 1 };
        }
        return prev;
      },
    },
    props: {
      decorations(state) {
        const ps = plugin.getState(state);
        if (!ps) return DecorationSet.empty;
        const cached = decoCache.get(ps);
        if (cached && cached.rev === ps.rev) return cached.set;

        const decos = [];
        for (const [pos, tokens] of Object.entries(ps.nodeMap)) {
          const p = Number(pos);
          for (const t of tokens) {
            decos.push(
              Decoration.inline(p + 1 + t.from, p + 1 + t.to, {
                class: t.class,
              })
            );
          }
        }
        const set = DecorationSet.create(state.doc, decos);
        decoCache.set(ps, { rev: ps.rev, set });
        return set;
      },
    },
  });
  return plugin;
}

export function parseHighlightedHtml(html) {
  const div = document.createElement('div');
  div.innerHTML = html;
  const tokens = [];
  let pos = 0;

  function traverse(node) {
    if (node.nodeType === Node.TEXT_NODE) {
      pos += node.textContent.length;
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const cls = Array.from(node.classList).find((c) =>
        c.startsWith('shj-syn-')
      );
      if (cls) {
        const text = node.textContent;
        if (text) {
          tokens.push({ from: pos, to: pos + text.length, class: cls });
        }
        pos += text.length;
      } else {
        for (const child of node.childNodes) traverse(child);
      }
    }
  }

  for (const child of div.childNodes) traverse(child);
  return tokens;
}
