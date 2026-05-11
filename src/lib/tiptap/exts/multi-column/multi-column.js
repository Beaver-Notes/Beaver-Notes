import { Extension } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';
import { columnsKeymap } from './keymap.js';
import { gridResizingPlugin } from './resize.js';

const MAX_COLUMNS = 5;

export const MultiColumn = Extension.create({
  name: 'multiColumn',

  addProseMirrorPlugins() {
    return [
      gridResizingPlugin({
        handleWidth: 2,
        minColumnFlex: 0.5,
      }),
      columnsKeymap,
    ];
  },

  addCommands() {
    return {
      insertMultiColumn:
        (num = 2) =>
        ({ tr, dispatch, editor }) => {
          const { schema } = editor;
          const { column, columns, paragraph } = schema.nodes;
          if (!column || !columns || !paragraph) return false;

          const safeNum = Math.min(Math.max(num, 2), MAX_COLUMNS);

          const initColumns = [];
          for (let i = 0; i < safeNum; i++) {
            initColumns.push(
              column.create(
                { flexGrow: 1 },
                paragraph.create()
              )
            );
          }

          const container = columns.create(null, initColumns);

          if (dispatch) {
            const insertPos = tr.selection.from;
            tr.replaceSelectionWith(container);

            const resolvedPos = tr.doc.resolve(insertPos);
            const selection = TextSelection.near(resolvedPos);

            tr.setSelection(selection).scrollIntoView();
          }

          return true;
        },
    };
  },
});