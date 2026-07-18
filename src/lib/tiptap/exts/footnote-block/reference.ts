import { mergeAttributes, Node } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { v4 as uuid } from 'uuid';

const REFNUM_ATTR = 'data-reference-number';
const REF_CLASS = 'footnote-ref';

const SUPERSCRIPT_MAP = {
  '\u2070': '0',
  '\u00B9': '1',
  '\u00B2': '2',
  '\u00B3': '3',
  '\u2074': '4',
  '\u2075': '5',
  '\u2076': '6',
  '\u2077': '7',
  '\u2078': '8',
  '\u2079': '9',
};
const SUPERSCRIPT_CHARS = new RegExp(
  `[${Object.keys(SUPERSCRIPT_MAP).join('')}]`,
  'g'
);

function normalizeSuperscript(text: string): string {
  return text.replace(SUPERSCRIPT_CHARS, (ch: string) => SUPERSCRIPT_MAP[ch as keyof typeof SUPERSCRIPT_MAP] || ch);
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    footnoteReference: {
      /**
       * add a new footnote reference
       * @example editor.commands.addFootnote()
       */
      addFootnote: () => ReturnType;
    };
  }
}

const FootnoteReference = Node.create({
  name: 'footnoteReference',
  inline: true,
  content: 'text*',
  group: 'inline',
  atom: true,
  draggable: true,

  parseHTML() {
    return [
      {
        tag: `sup a.${REF_CLASS}`,
        priority: 1000,
      },
    ];
  },

  addAttributes() {
    return {
      class: {
        default: REF_CLASS,
      },
      'data-id': {
        parseHTML(element) {
          return element.getAttribute('data-id') || uuid();
        },
        renderHTML(attributes) {
          return {
            'data-id': attributes['data-id'] || uuid(),
          };
        },
      },
      referenceNumber: {
        parseHTML(element) {
          return element.getAttribute(REFNUM_ATTR) || element.innerText;
        },
      },
      href: {
        renderHTML(attributes) {
          return {
            href: `#fn:${attributes['referenceNumber']}`,
          };
        },
      },
    };
  },

  renderHTML({ HTMLAttributes }) {
    const { referenceNumber, ...attributes } = HTMLAttributes;
    const attrs = mergeAttributes(this.options.HTMLAttributes, attributes);
    attrs[REFNUM_ATTR] = referenceNumber;

    return [
      'sup',
      { id: `fnref:${referenceNumber}` },
      ['a', attrs, HTMLAttributes.referenceNumber],
    ];
  },

  addProseMirrorPlugins() {
    const { editor } = this;
    return [
      new Plugin({
        key: new PluginKey('footnoteRefClick'),

        props: {
          // click the footnote reference once to get focus, click twice to scroll to the footnote
          handleClickOn(view, pos, node, nodePos, event) {
            if (node.type.name != 'footnoteReference') return false;
            event.preventDefault();
            const id = node.attrs['data-id'];
            return editor.commands.focusFootnote(id);
          },

          handlePaste(view, event, _slice) {
            const text = event.clipboardData?.getData('text/plain');
            if (!text) return false;

            const footnoteRefs = [];
            const regex = /\[\^(\d+)\]|\[([\u00B9\u00B2\u00B3\u2070\u2074\u2075\u2076\u2077\u2078\u2079]+)\]/g;
            let match;
            while ((match = regex.exec(text)) !== null) {
              const rawNumber = match[1] || match[2];
              footnoteRefs.push({
                number: normalizeSuperscript(rawNumber),
                index: match.index,
                length: match[0].length,
              });
            }

            let offset = 0;
            let newText = text;
            footnoteRefs.forEach(({ number, index, length }) => {
              const refNode = `<sup id="fnref:${number}"><a class="${REF_CLASS}" href="#fn:${number}" data-reference-number="${number}">${number}</a></sup>`;
              newText =
                newText.slice(0, index + offset) +
                refNode +
                newText.slice(index + offset + length);
              offset += refNode.length - length;
            });

            const { tr } = view.state;
            tr.replaceSelectionWith(view.state.schema.text(newText));
            view.dispatch(tr);
            return true;
          },
        },
      }),
    ];
  },

  addCommands() {
    return {
      addFootnote:
        () =>
          ({ state, tr }) => {
            const node = this.type.create({
              'data-id': uuid(),
            });
            tr.insert(state.selection.anchor, node);
            return true;
          },
    };
  },

  addInputRules() {
    return [
      {
        find: /\[\^(\d+)\]$/,
        type: this.type,
        undoable: false,
        handler({ range, match, chain }) {
          const start = range.from;
          const end = range.to;

          if (match[1]) {
            chain().deleteRange({ from: start, to: end }).addFootnote().run();
          }
        },
      },
      {
        find: /\[[\u00B9\u00B2\u00B3\u2070\u2074\u2075\u2076\u2077\u2078\u2079]+\]$/,
        type: this.type,
        undoable: false,
        handler({ range, chain }) {
          chain().deleteRange({ from: range.from, to: range.to }).addFootnote().run();
        },
      },
    ];
  },

});

export default FootnoteReference;
