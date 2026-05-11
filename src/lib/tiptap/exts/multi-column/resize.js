import { Plugin } from '@tiptap/pm/state';
import {
  handleGridDecorations,
  handleMouseDown,
  handleMouseLeave,
  handleMouseMove,
  handleMouseUp,
} from './dom.js';
import { gridResizingPluginKey, GridResizeState } from './state.js';

export function gridResizingPlugin(options) {
  const handleWidth = options?.handleWidth ?? 2;
  const minFlex = options?.minColumnFlex ?? 0.1;

  return new Plugin({
    key: gridResizingPluginKey,

    state: {
      init: () => new GridResizeState(-1, null),
      apply: (tr, prev) => {
        return prev.apply(tr);
      },
    },

    props: {
      attributes: (state) => {
        const pluginState = gridResizingPluginKey.getState(state);
        if (pluginState && pluginState.activeHandle > -1) {
          return { class: 'resize-cursor' };
        }
        return {};
      },

      handleDOMEvents: {
        mousemove: (view, event) => {
          return handleMouseMove(view, event, handleWidth);
        },
        mouseleave: (view) => {
          return handleMouseLeave(view);
        },
        mousedown: (view, event) => {
          return handleMouseDown(view, event, minFlex);
        },
        mouseup: (view, event) => {
          return handleMouseUp(view, event);
        },
      },

      decorations: (state) => {
        const pluginState = gridResizingPluginKey.getState(state);
        if (!pluginState) return null;
        if (pluginState.activeHandle === -1) return null;

        return handleGridDecorations(state, pluginState.activeHandle);
      },
    },
  });
}