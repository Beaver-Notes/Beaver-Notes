import { Node, mergeAttributes, VueNodeViewRenderer } from '@tiptap/vue-3';
import Component from './Paper.vue';
import { parseStrokes } from './ink/stroke-model';

export default Node.create({
  name: 'paper',

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
      // strokes: canonical v3 - {id, tool, color, size, opacity, shape?, points:[[x,y,pressure]]}
      strokes: {
        default: [],
        parseHTML: (el) =>
          parseStrokes(
            el.getAttribute('data-lines-v3') ||
              el.getAttribute('data-lines-v2') ||
              el.getAttribute('data-lines') ||
              '[]',
          ),
        renderHTML: (attrs) => ({
          'data-lines-v3': JSON.stringify(parseStrokes(attrs.strokes ?? [])),
        }),
      },
      height: { default: 210 },
      paperType: { default: 'transparent' },
      // Legacy stroke payloads: read-only so Yjs-backed notes (which bypass
      // parseHTML) surface their old attrs to PaperStrokesMigration. Never
      // rendered; nulled out by the migration.
      linesV2: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-lines-v2'),
        renderHTML: () => ({}),
      },
      lines: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-lines'),
        renderHTML: () => ({}),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="paper"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-type': 'paper',
        style: `height: ${HTMLAttributes.height}px;`,
      }),
    ];
  },

  addNodeView() {
    return VueNodeViewRenderer(Component);
  },

  addCommands() {
    return {
      insertPaper:
        () =>
        ({ commands }) => {
          return commands.insertContent({
            type: 'paper',
            attrs: { strokes: [], height: 210, paperType: 'transparent' },
          });
        },
    };
  },
});
