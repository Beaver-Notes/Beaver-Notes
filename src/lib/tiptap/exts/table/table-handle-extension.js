import { Extension } from '@tiptap/core';
import { TableHandlePlugin, tableHandlePluginKey } from './table-handle-plugin.js';

export const TableHandleExtension = Extension.create({
  name: 'tableHandleExtension',

  addCommands() {
    return {
      freezeHandles:
        () =>
        ({ tr, dispatch }) => {
          if (dispatch) tr.setMeta(tableHandlePluginKey, true);
          return true;
        },
      unfreezeHandles:
        () =>
        ({ tr, dispatch }) => {
          if (dispatch) tr.setMeta(tableHandlePluginKey, false);
          return true;
        },
    };
  },

  addProseMirrorPlugins() {
    const { editor } = this;
    return [
      TableHandlePlugin(editor, (state) => {
        editor.emit('tableHandleState', state);
      }),
    ];
  },
});
