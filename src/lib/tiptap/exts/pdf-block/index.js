import { Node, mergeAttributes, VueNodeViewRenderer } from '@tiptap/vue-3';
import Component from './PdfBlockComponent.vue';
import { parseStrokes } from '../paper-block/ink/stroke-model';

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
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="pdf-block"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, { 'data-type': 'pdf-block' }),
    ];
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
