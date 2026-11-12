import { TextSelection } from '@tiptap/pm/state';
import CodeBlock from '@tiptap/extension-code-block';
import { createCodeHighlightPlugin } from './plugin';
import { LANGUAGES } from './languages';

/**
 * Empty the block and exit it to a paragraph in a single transaction (one
 * undo step). `clearNodes` can't be chained after a deletion: it walks the
 * stale pre-chain doc and silently no-ops.
 */
function emptyAndExit(editor, blockName) {
  const { $anchor } = editor.state.selection;
  if ($anchor.parent.type.name !== blockName) {
    return false;
  }
  const paragraph = editor.schema.nodes.paragraph;
  if (!paragraph) {
    return editor.commands.clearNodes();
  }
  const contentStart = $anchor.start();
  const contentEnd = $anchor.end();
  return editor.commands.command(({ tr }) => {
    if (contentEnd > contentStart) {
      tr.delete(contentStart, contentEnd);
    }
    tr.setNodeMarkup(contentStart - 1, paragraph);
    tr.setSelection(TextSelection.create(tr.doc, contentStart, contentStart));
    return true;
  });
}

/**
 * Shared Backspace/Delete handling for code blocks. Goal: never strand an
 * empty code block (toolbar pill with no body). The press that empties the
 * block also exits it:
 * - empty block -> clearNodes (exit to paragraph)
 * - selection covers the whole block text -> delete + exit
 * - cursor on the last remaining character -> delete + exit
 * Anything else falls through to the default behavior.
 */
function handleDeleteKey(editor, blockName, direction) {
  const { empty, $anchor, $from, $to } = editor.state.selection;
  if ($anchor.parent.type.name !== blockName) {
    return false;
  }

  const parent = $anchor.parent;
  const textLength = parent.textContent.length;

  if (textLength === 0) {
    return editor.commands.clearNodes();
  }

  if (!empty) {
    const coversAll =
      $from.parent === parent &&
      $to.parent === parent &&
      $from.parentOffset === 0 &&
      $to.parentOffset === textLength;
    if (!coversAll) {
      return false;
    }
    return emptyAndExit(editor, blockName);
  }

  const onLastChar =
    textLength === 1 &&
    (direction === 'backward'
      ? $anchor.parentOffset === 1
      : $anchor.parentOffset === 0);
  if (onLastChar) {
    return emptyAndExit(editor, blockName);
  }
  if ($anchor.parentOffset === 0) {
    return editor.commands.clearNodes();
  }
  return false;
}

export default CodeBlock.extend({
  /**
   * Plain node view (no per-block Vue component): markdown imports routinely
   * carry hundreds of code blocks, and a full Vue component per block made
   * opening such notes take seconds. The editable code text is PM-managed DOM
   * (contentDOM), so typing/copying/selection are untouched; the interactive
   * chrome (language picker, copy, delete) and the line-number gutter mount
   * only when a block approaches the viewport.
   */
  addNodeView() {
    return ({ node, editor, getPos }) => {
      const wrapper = document.createElement('div');
      wrapper.className = 'codeblock-lazy relative';

      const pre = document.createElement('pre');
      pre.className = 'codeblock-pre';
      const gutter = document.createElement('span');
      gutter.className = 'codeblock-gutter';
      gutter.contentEditable = 'false';
      gutter.setAttribute('aria-hidden', 'true');
      const code = document.createElement('code');
      code.className = 'hljs' + (node.attrs.language ? ` language-${node.attrs.language}` : '');
      pre.appendChild(gutter);
      pre.appendChild(code);
      wrapper.appendChild(pre);

      let current = node;
      let chrome = null;
      let observer = null;

      const renderGutter = () => {
        const lines = current.textContent.split('\n').length;
        gutter.style.minWidth = `${String(lines).length + 1}ch`;
        gutter.textContent = '';
        for (let i = 1; i <= lines; i++) {
          const line = document.createElement('span');
          line.textContent = i;
          gutter.appendChild(line);
        }
      };

      const buildChrome = () => {
        const bar = document.createElement('div');
        bar.className =
          'absolute right-2 top-2 z-10 flex items-center gap-1 border rounded-lg px-2 py-1 print:hidden bg-white dark:bg-neutral-900 border-neutral-200 dark:border-neutral-700';
        bar.contentEditable = 'false';

        const select = document.createElement('select');
        select.className =
          'text-xs rounded px-1 py-0.5 bg-white dark:bg-neutral-900 border-neutral-200 dark:border-neutral-700 max-w-32';
        const autoOption = document.createElement('option');
        autoOption.value = '';
        autoOption.textContent = 'auto';
        select.appendChild(autoOption);
        for (const lang of LANGUAGES) {
          const option = document.createElement('option');
          option.value = lang;
          option.textContent = lang;
          select.appendChild(option);
        }
        select.value = current.attrs.language || '';
        select.addEventListener('change', () => setLanguage(select.value));
        bar.appendChild(select);

        const copy = document.createElement('button');
        copy.type = 'button';
        copy.title = 'Copy code';
        copy.setAttribute('aria-label', 'Copy code');
        copy.className =
          'px-1 text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100';
        copy.textContent = '⧉';
        copy.addEventListener('mousedown', (e) => e.stopPropagation());
        copy.addEventListener('click', (e) => {
          e.stopPropagation();
          if (navigator.clipboard?.writeText) {
            navigator.clipboard.writeText(current.textContent).catch(() => {});
          }
        });
        bar.appendChild(copy);

        const del = document.createElement('button');
        del.type = 'button';
        del.title = 'Delete code block';
        del.setAttribute('aria-label', 'Delete code block');
        del.className =
          'px-1 text-neutral-500 hover:text-red-600 dark:hover:text-red-400';
        del.textContent = '✕';
        del.addEventListener('mousedown', (e) => e.stopPropagation());
        del.addEventListener('click', (e) => {
          e.stopPropagation();
          const pos = typeof getPos === 'function' ? getPos() : null;
          if (pos == null) return;
          const tr = editor.state.tr.delete(pos, pos + current.nodeSize);
          editor.view.dispatch(tr);
        });
        bar.appendChild(del);
        return bar;
      };

      const mountChrome = () => {
        if (chrome) return;
        chrome = buildChrome();
        wrapper.appendChild(chrome);
        renderGutter();
      };

      if (typeof IntersectionObserver !== 'undefined') {
        observer = new IntersectionObserver(
          (entries) => {
            for (const entry of entries) {
              if (entry.isIntersecting) {
                mountChrome();
                if (observer) {
                  observer.disconnect();
                  observer = null;
                }
                break;
              }
            }
          },
          { rootMargin: '600px 0px' },
        );
        observer.observe(wrapper);
      } else {
        mountChrome();
      }

      return {
        dom: wrapper,
        contentDOM: code,
        update(newNode) {
          if (newNode.type.name !== 'codeBlock') return false;
          current = newNode;
          const lang = current.attrs.language || '';
          code.className = 'hljs' + (lang ? ` language-${lang}` : '');
          if (chrome) {
            const select = chrome.querySelector('select');
            if (select) select.value = lang;
            renderGutter();
          } else {
            const lines = current.textContent.split('\n').length;
            gutter.style.minWidth = `${String(lines).length + 1}ch`;
          }
          return true;
        },
        selectNode() {
          mountChrome();
        },
        ignoreMutation(mutation) {
          if (mutation.type === 'selection') return false;
          return !code.contains(mutation.target);
        },
        stopEvent(event) {
          if (!chrome) return false;
          return chrome.contains(event.target);
        },
        destroy() {
          if (observer) observer.disconnect();
        },
      };
    };
  },

  addKeyboardShortcuts() {
    return {
      ...(typeof this.parent === 'function' ? this.parent() : {}),

      Backspace: () => handleDeleteKey(this.editor, this.name, 'backward'),
      Delete: () => handleDeleteKey(this.editor, this.name, 'forward'),
    };
  },

  addAttributes() {
    return {
      language: {
        default: null,
        parseHTML: (element) =>
          // marked/markdown-it emit `<pre><code class="language-js">`; without
          // the class fallback, markdown imports silently lose the language.
          element.getAttribute('language') ||
          element.dataset?.language ||
          (element.querySelector('code')?.className || '').match(/language-([\w+#-]+)/)?.[1] ||
          (element.className || '').match(/language-([\w+#-]+)/)?.[1] ||
          null,
        renderHTML: (attributes) => ({ language: attributes.language }),
      },
    };
  },

  addProseMirrorPlugins() {
    return [createCodeHighlightPlugin(this.name)];
  },
});
