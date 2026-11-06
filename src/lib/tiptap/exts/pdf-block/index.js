import { Node, mergeAttributes, VueNodeViewRenderer } from '@tiptap/vue-3';
import Component from './PdfBlockComponent.vue';
import { parseStrokes } from '../paper-block/ink/stroke-model';
import { sanitizeFileSource } from '@/utils/note/contentSecurity.js';
import { isPdfEmbed } from './migrate';

function parsePdfAttrs(el) {
  const rawSrc = el.getAttribute('data-src') || '';
  const src = sanitizeFileSource(rawSrc);
  // Keep pending inserts (empty src), drop unsafe schemes entirely.
  if (rawSrc && !src) return false;
  return {
    src: src || null,
    fileName: el.getAttribute('data-file-name'),
    markup: parseStrokes(el.getAttribute('data-markup') || '[]'),
  };
}

export default Node.create({
  name: 'pdfBlock',

  group: 'block',
  atom: true,

  addOptions() {
    return {
      ...this.parent?.(),
      selectable: true,
      draggable: false,
      allowGapCursor: true,
    };
  },

  addAttributes() {
    return {
      // markup strokes: v3 stroke + page index; points are page-local and may
      // exceed page bounds (margin spill)
      markup: {
        default: [],
        parseHTML: (el) => parseStrokes(el.getAttribute('data-markup') || '[]'),
        renderHTML: (attrs) => ({
          'data-markup': JSON.stringify(parseStrokes(attrs.markup ?? [])),
        }),
      },
      src: { default: null },
      fileName: { default: null },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-type="pdf-block"]',
        getAttrs: (el) => parsePdfAttrs(el),
      },
      {
        // Legacy fileEmbed spans carrying PDFs (pre-pdf-block exports).
        tag: 'span[data-file-name]',
        getAttrs: (el) => {
          if (!isPdfEmbed({ attrs: { fileName: el.getAttribute('data-file-name'), src: el.getAttribute('data-src') } })) {
            return false;
          }
          return parsePdfAttrs(el);
        },
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    const attrs = {};
    for (const [key, value] of Object.entries(HTMLAttributes)) {
      if (value == null) continue;
      const name =
        key === 'src' ? 'data-src' : key === 'fileName' ? 'data-file-name' : key;
      attrs[name] = value;
    }
    return ['div', mergeAttributes(attrs, { 'data-type': 'pdf-block' })];
  },

  addNodeView() {
    return VueNodeViewRenderer(Component);
  },

  addCommands() {
    return {
      insertPdfBlock:
        (attrs = {}) =>
        ({ commands }) => {
          return commands.insertContent({ type: 'pdfBlock', attrs });
        },
    };
  },
});
