import { Node, mergeAttributes } from '@tiptap/core';

function findOverlayNode(state) {
  let match = null;

  state.doc.descendants((node, pos) => {
    if (node.type.name === 'overlayDrawing') {
      match = { node, pos };
      return false;
    }

    return true;
  });

  return match;
}

export default Node.create({
  name: 'overlayDrawing',

  group: 'block',
  atom: true,

  addOptions() {
    return {
      ...this.parent?.(),
      selectable: false,
      draggable: false,
      allowGapCursor: false,
    };
  },

  addAttributes() {
    return {
      strokes: {
        default: [],
        parseHTML: (element) => {
          try {
            return JSON.parse(element.getAttribute('data-strokes') || '[]');
          } catch {
            return [];
          }
        },
        renderHTML: (attributes) => ({
          'data-strokes': JSON.stringify(attributes.strokes || []),
        }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="overlay-drawing"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-type': 'overlay-drawing',
        style: 'display:none',
      }),
    ];
  },

  addCommands() {
    return {
      setOverlayStrokes:
        (strokes = []) =>
        ({ state, dispatch }) => {
          const match = findOverlayNode(state);

          if (match) {
            if (!dispatch) return true;

            dispatch(
              state.tr.setNodeMarkup(match.pos, undefined, {
                ...match.node.attrs,
                strokes,
              })
            );

            return true;
          }

          const footnotes = state.doc.lastChild?.type?.name === 'footnotes';
          const insertPos = footnotes
            ? state.doc.content.size - state.doc.lastChild.nodeSize
            : state.doc.content.size;

          if (!dispatch) return true;

          const node = this.type.create({ strokes });
          dispatch(state.tr.insert(insertPos, node));

          return true;
        },

      getOverlayStrokes:
        () =>
        ({ state }) => {
          const match = findOverlayNode(state);
          return Array.isArray(match?.node?.attrs?.strokes)
            ? match.node.attrs.strokes
            : [];
        },
    };
  },
});
