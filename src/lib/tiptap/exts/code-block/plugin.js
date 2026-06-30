import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

export const codeHighlightPluginKey = new PluginKey('code-highlight');

export function createCodeHighlightPlugin() {
  const plugin = new Plugin({
    key: codeHighlightPluginKey,
    state: {
      init() {
        return {};
      },
      apply(tr, nodeMap) {
        const meta = tr.getMeta(codeHighlightPluginKey);
        if (meta) {
          if (meta.tokens.length === 0) {
            const next = { ...nodeMap };
            delete next[meta.nodePos];
            return next;
          }
          return { ...nodeMap, [meta.nodePos]: meta.tokens };
        }
        if (tr.docChanged) {
          const next = {};
          for (const [pos, tokens] of Object.entries(nodeMap)) {
            const newPos = tr.mapping.map(Number(pos));
            next[newPos] = tokens;
          }
          return next;
        }
        return nodeMap;
      },
    },
    props: {
      decorations(state) {
        const nodeMap = plugin.getState(state);
        const decos = [];
        for (const [pos, tokens] of Object.entries(nodeMap)) {
          const p = Number(pos);
          for (const t of tokens) {
            decos.push(
              Decoration.inline(p + 1 + t.from, p + 1 + t.to, {
                class: t.class,
              })
            );
          }
        }
        return DecorationSet.create(state.doc, decos);
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
