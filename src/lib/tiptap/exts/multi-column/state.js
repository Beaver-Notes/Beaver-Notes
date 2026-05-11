import { PluginKey, Transaction } from '@tiptap/pm/state';

export const gridResizingPluginKey = new PluginKey('gridResizingPlugin');

export class GridResizeState {
  activeHandle;
  dragging;

  constructor(activeHandle, dragging) {
    this.activeHandle = activeHandle;
    this.dragging = dragging;
  }

  apply(tr) {
    const action = tr.getMeta(gridResizingPluginKey);
    if (action?.setHandle !== undefined) {
      return new GridResizeState(action.setHandle, this.dragging);
    }
    if (action?.setDragging !== undefined) {
      return new GridResizeState(this.activeHandle, action.setDragging);
    }
    return this;
  }
}