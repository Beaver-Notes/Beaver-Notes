import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { CellSelection, moveTableColumn, moveTableRow, TableMap } from '@tiptap/pm/tables';
import {
  clamp,
  domCellAround,
  getCellIndicesFromDOM,
  getColumnCells,
  getRowCells,
  getTable,
  getTableFromDOM,
  isHTMLElement,
  isTableNode,
  safeClosest,
  selectCellsByCoords,
  rectEq,
} from './tiptap-table-utils.js';
import { createTableDragImage } from './create-image.js';

export const tableHandlePluginKey = new PluginKey('tableHandlePlugin');

const _EMPTY_STATE = {
  show: false,
  showAddOrRemoveRowsButton: false,
  showAddOrRemoveColumnsButton: false,
  referencePosTable: null,
  referencePosWrapper: null,
  block: null,
  blockPos: -1,
  colIndex: undefined,
  rowIndex: undefined,
  draggingState: undefined,
  widgetContainer: undefined,
  referencePosCell: undefined,
};

function hideElements(selector, rootEl) {
  rootEl.querySelectorAll(selector).forEach((el) => {
    el.style.visibility = 'hidden';
  });
}

export class TableHandleView {
  constructor(editor, editorView, emitUpdate) {
    this.editor = editor;
    this.editorView = editorView;
    this.state = undefined;
    this.menuFrozen = false;
    this.mouseState = 'up';
    this.tableId = undefined;
    this.tablePos = undefined;
    this.tableElement = undefined;

    this.emitUpdate = () => this.state && emitUpdate(this.state);

    this._mouseMoveHandler = this._mouseMoveHandler.bind(this);
    this._viewMousedownHandler = this._viewMousedownHandler.bind(this);
    this._mouseUpHandler = this._mouseUpHandler.bind(this);
    this._dragOverHandler = this._dragOverHandler.bind(this);
    this._dropHandler = this._dropHandler.bind(this);
    this._scrollHandler = this._scrollHandler.bind(this);
    this._recomputeHandlePositions = this._recomputeHandlePositions.bind(this);

    this._resizeObserver = new ResizeObserver(() => {
      if (this._resizeRaf) return;
      this._resizeRaf = requestAnimationFrame(() => {
        this._resizeRaf = null;
        this._recomputeHandlePositions();
      });
    });
    this._resizeObserver.observe(this.editorView.dom);

    this.editorView.dom.addEventListener('mousemove', this._mouseMoveHandler);
    this.editorView.dom.addEventListener('mousedown', this._viewMousedownHandler);
    window.addEventListener('mouseup', this._mouseUpHandler);
    this.editorView.root.addEventListener('dragover', this._dragOverHandler);
    this.editorView.root.addEventListener('drop', this._dropHandler);
    window.addEventListener('scroll', this._scrollHandler, true);

    // Continuously track the table position so the floating handles follow
    // it on every layout change (scroll, sidebar toggle, animations) without
    // waiting for a document transaction. Early-returns and equality guards
    // make it effectively free while no table is hovered.
    this._rafId = null;
    this._startTracking();
  }

  _startTracking() {
    if (this._rafId != null) return;
    const loop = () => {
      this._recomputeHandlePositions();
      this._rafId = requestAnimationFrame(loop);
    };
    this._rafId = requestAnimationFrame(loop);
  }

  _viewMousedownHandler(event) {
    this.mouseState = 'down';
    const { state, view } = this.editor;
    if (!(state.selection instanceof CellSelection) || this.editor.isFocused) return;

    const posInfo = view.posAtCoords({ left: event.clientX, top: event.clientY });
    if (!posInfo) return;

    const $pos = state.doc.resolve(posInfo.pos);
    const { nodes } = state.schema;
    let paraDepth = -1;
    let inTableCell = false;

    for (let d = $pos.depth; d >= 0; d--) {
      const node = $pos.node(d);
      if (!inTableCell && (node.type === nodes.tableCell || node.type === nodes.tableHeader)) {
        inTableCell = true;
      }
      if (paraDepth === -1 && node.type === nodes.paragraph) {
        paraDepth = d;
      }
      if (inTableCell && paraDepth !== -1) break;
    }

    if (!inTableCell || paraDepth === -1) return;

    const from = $pos.start(paraDepth);
    const to = $pos.end(paraDepth);
    const nextSel = TextSelection.create(state.doc, from, to);
    if (state.selection.eq(nextSel)) return;

    view.dispatch(state.tr.setSelection(nextSel));
    view.focus();
  }

  _mouseUpHandler(event) {
    this.mouseState = 'up';
    this._mouseMoveHandler(event);
  }

  _mouseMoveHandler(event) {
    if (this.menuFrozen || this.mouseState === 'selecting') return;
    const target = event.target;
    if (!isHTMLElement(target) || !this.editorView.dom.contains(target)) return;
    this._handleMouseMoveNow(event);
  }

  _scrollHandler() {
    this._clearHideTimeout();
    if (this._scrollThrottle) return;
    this._scrollThrottle = true;
    requestAnimationFrame(() => { this._scrollThrottle = false; });
    this._recomputeHandlePositions();
  }

  _recomputeHandlePositions() {
    if (!this.state?.show || this.menuFrozen) return;
    const { rowIndex, colIndex } = this.state;
    if (rowIndex === undefined || colIndex === undefined) return;
    if (!this.tableElement?.isConnected || !this.editor) return;

    const tableBody = this.tableElement.querySelector('tbody');
    if (!tableBody) return;

    const rowEl = tableBody.children[rowIndex];
    const cellEl = rowEl?.children[colIndex];
    if (!cellEl) return;

    const wrapper = this.tableElement.closest('.tableWrapper');

    const newCell = cellEl.getBoundingClientRect();
    const newTable = tableBody.getBoundingClientRect();
    const newWrapper = wrapper?.getBoundingClientRect();

    if (
      rectEq(this.state.referencePosCell, newCell) &&
      rectEq(this.state.referencePosTable, newTable) &&
      rectEq(this.state.referencePosWrapper, newWrapper)
    ) {
      return;
    }

    this.state = {
      ...this.state,
      referencePosCell: newCell,
      referencePosTable: newTable,
      referencePosWrapper: newWrapper,
    };
    this.emitUpdate();
  }

  _hideHandles() {
    if (!this.state?.show) return;
    if (this._hideTimeout) return;
    this._hideTimeout = setTimeout(() => {
      this._hideTimeout = null;
      if (!this.state?.show) return;
      this.state = { ...this.state, show: false, showAddOrRemoveRowsButton: false, showAddOrRemoveColumnsButton: false, colIndex: undefined, rowIndex: undefined, referencePosCell: undefined };
      this.emitUpdate();
    }, 100);
  }

  _clearHideTimeout() {
    if (this._hideTimeout) {
      clearTimeout(this._hideTimeout);
      this._hideTimeout = null;
    }
  }

  _handleMouseMoveNow(event) {
    this._clearHideTimeout();
    const around = domCellAround(event.target);

    if (around?.type === 'cell' && this.mouseState === 'down' && !this.state?.draggingState) {
      this.mouseState = 'selecting';
      this._hideHandles();
      return;
    }

    if (!around || !this.editor.isEditable) {
      this._hideHandles();
      return;
    }

    const tbody = around.tbodyNode;
    if (!tbody) return;

    const tableRect = tbody.getBoundingClientRect();
    const coords = this.editor.view.posAtCoords({ left: event.clientX, top: event.clientY });
    if (!coords) return;

    const $pos = this.editor.view.state.doc.resolve(coords.pos);
    let blockInfo;
    for (let d = $pos.depth; d >= 0; d--) {
      const node = $pos.node(d);
      if (isTableNode(node)) {
        blockInfo = { node, pos: d === 0 ? 0 : $pos.before(d) };
        break;
      }
    }
    if (!blockInfo || blockInfo.node.type.name !== 'table') return;

    this.tableElement = this.editor.view.nodeDOM(blockInfo.pos);
    this.tablePos = blockInfo.pos;
    this.tableId = blockInfo.node.attrs.id;

    const wrapper = safeClosest(around.domNode, '.tableWrapper');
    const widgetContainer = wrapper?.querySelector('.table-controls');

    if (around.type === 'wrapper') {
      const below = event.clientY >= tableRect.bottom - 1 && event.clientY < tableRect.bottom + 20;
      const right = event.clientX >= tableRect.right - 1 && event.clientX < tableRect.right + 20;
      const cursorBeyondRightOrBottom = event.clientX > tableRect.right || event.clientY > tableRect.bottom;

      this.state = {
        ...this.state,
        show: true,
        showAddOrRemoveRowsButton: below,
        showAddOrRemoveColumnsButton: right,
        referencePosTable: tableRect,
        referencePosWrapper: wrapper?.getBoundingClientRect(),
        block: blockInfo.node,
        blockPos: blockInfo.pos,
        widgetContainer,
        colIndex: cursorBeyondRightOrBottom ? undefined : this.state?.colIndex,
        rowIndex: cursorBeyondRightOrBottom ? undefined : this.state?.rowIndex,
        referencePosCell: cursorBeyondRightOrBottom ? undefined : this.state?.referencePosCell,
      };
    } else {
      const cellPosition = getCellIndicesFromDOM(around.domNode, blockInfo.node, this.editor);
      if (!cellPosition) return;

      const { rowIndex, colIndex } = cellPosition;
      const cellRect = around.domNode.getBoundingClientRect();
      const lastRowIndex = blockInfo.node.content.childCount - 1;
      const lastColIndex = (blockInfo.node.content.firstChild?.content.childCount ?? 0) - 1;

      if (
        this.state?.show &&
        this.tableId === blockInfo.node.attrs.id &&
        this.state.rowIndex === rowIndex &&
        this.state.colIndex === colIndex
      ) {
        return;
      }

      this.state = {
        show: true,
        showAddOrRemoveColumnsButton: colIndex === lastColIndex,
        showAddOrRemoveRowsButton: rowIndex === lastRowIndex,
        referencePosTable: tableRect,
        referencePosWrapper: wrapper?.getBoundingClientRect(),
        block: blockInfo.node,
        blockPos: blockInfo.pos,
        draggingState: undefined,
        referencePosCell: cellRect,
        colIndex,
        rowIndex,
        widgetContainer,
      };
    }

    this.emitUpdate();
  }

  _dragOverHandler(event) {
    if (this.state?.draggingState === undefined) return;

    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';

    hideElements('.prosemirror-dropcursor-block, .prosemirror-dropcursor-inline', this.editorView.root);

    const { left: tableLeft, right: tableRight, top: tableTop, bottom: tableBottom } = this.state.referencePosTable;
    const boundedMouseCoords = {
      left: clamp(event.clientX, tableLeft + 1, tableRight - 1),
      top: clamp(event.clientY, tableTop + 1, tableBottom - 1),
    };

    const tableCellElements = this.editorView.root
      .elementsFromPoint(boundedMouseCoords.left, boundedMouseCoords.top)
      .filter((el) => el.tagName === 'TD' || el.tagName === 'TH');

    if (tableCellElements.length === 0) return;
    const tableCellElement = tableCellElements[0];
    if (!isHTMLElement(tableCellElement)) return;

    const cellPosition = getCellIndicesFromDOM(tableCellElement, this.state.block, this.editor);
    if (!cellPosition) return;

    const { rowIndex, colIndex } = cellPosition;
    const oldIndex = this.state.draggingState.draggedCellOrientation === 'row' ? this.state.rowIndex : this.state.colIndex;
    const newIndex = this.state.draggingState.draggedCellOrientation === 'row' ? rowIndex : colIndex;
    const dispatchDecorationsTransaction = newIndex !== oldIndex;

    const mousePos = this.state.draggingState.draggedCellOrientation === 'row' ? boundedMouseCoords.top : boundedMouseCoords.left;

    const cellChanged = this.state.rowIndex !== rowIndex || this.state.colIndex !== colIndex;
    const mousePosChanged = this.state.draggingState.mousePos !== mousePos;

    if (cellChanged || mousePosChanged) {
      this.state = {
        ...this.state,
        rowIndex,
        colIndex,
        referencePosCell: tableCellElement.getBoundingClientRect(),
        draggingState: { ...this.state.draggingState, mousePos },
      };
      this.emitUpdate();
    }

    if (dispatchDecorationsTransaction) {
      this.editor.view.dispatch(this.editor.state.tr.setMeta(tableHandlePluginKey, true));
    }
  }

  _dropHandler(event) {
    this.mouseState = 'up';
    const st = this.state;
    if (!st?.draggingState) return false;
    event.preventDefault();

    const { draggingState, rowIndex, colIndex, blockPos } = st;
    if (
      (draggingState.draggedCellOrientation === 'row' && rowIndex === undefined) ||
      (draggingState.draggedCellOrientation === 'col' && colIndex === undefined)
    ) {
      return false;
    }

    const isRow = draggingState.draggedCellOrientation === 'row';
    const orientation = isRow ? 'row' : 'column';
    const destIndex = isRow ? rowIndex : colIndex;

    const cellCoords = (() => {
      if (!this.editor) return null;
      const table = getTable(this.editor, blockPos);
      if (!table) return null;
      const { map } = table;
      if (draggingState.originalIndex < 0) return null;
      if (orientation === 'row' && draggingState.originalIndex >= map.height) return null;
      if (orientation === 'column' && draggingState.originalIndex >= map.width) return null;
      return orientation === 'row'
        ? Array.from({ length: map.width }, (_, col) => ({ row: draggingState.originalIndex, col }))
        : Array.from({ length: map.height }, (_, row) => ({ row, col: draggingState.originalIndex }));
    })();
    if (!cellCoords) return false;

    const stateWithCellSel = selectCellsByCoords(this.editor, blockPos, cellCoords, { mode: 'state' });
    if (!stateWithCellSel) return false;

    const dispatch = (tr) => this.editor.view.dispatch(tr);

    if (isRow) {
      moveTableRow({ from: draggingState.originalIndex, to: destIndex, select: true, pos: blockPos + 1 })(stateWithCellSel, dispatch);
    } else {
      moveTableColumn({ from: draggingState.originalIndex, to: destIndex, select: true, pos: blockPos + 1 })(stateWithCellSel, dispatch);
    }

    this.state = { ...st, draggingState: undefined };
    this.emitUpdate();
    this.editor.view.dispatch(this.editor.state.tr.setMeta(tableHandlePluginKey, null));
    return true;
  }

  update(view) {
    const pluginState = tableHandlePluginKey.getState(view.state);
    if (pluginState !== undefined && pluginState !== this.menuFrozen) {
      this.menuFrozen = pluginState;
    }

    if (!this.state?.show) return;
    if (!this.tableElement?.isConnected) { this._hideHandles(); return; }

    const tableInfo = getTableFromDOM(this.tableElement, this.editor);
    if (!tableInfo) { this._hideHandles(); return; }

    if (!tableInfo.node || tableInfo.node.type.name !== 'table' || !this.tableElement?.isConnected) {
      this._hideHandles();
      return;
    }

    const tableMap = TableMap.get(tableInfo.node);
    const rowCount = tableMap.height;
    const colCount = tableMap.width;

    let newRowIndex = this.state.rowIndex;
    let newColIndex = this.state.colIndex;

    if (newRowIndex !== undefined && newRowIndex >= rowCount) {
      newRowIndex = rowCount ? rowCount - 1 : undefined;
    }
    if (newColIndex !== undefined && newColIndex >= colCount) {
      newColIndex = colCount ? colCount - 1 : undefined;
    }

    const tableBody = this.tableElement.querySelector('tbody');
    if (!tableBody) return;

    let newReferencePosCell = this.state.referencePosCell;
    if (newRowIndex !== undefined && newColIndex !== undefined) {
      const rowEl = tableBody.children[newRowIndex];
      const cellEl = rowEl?.children[newColIndex];
      if (cellEl) {
        newReferencePosCell = cellEl.getBoundingClientRect();
      } else {
        newRowIndex = undefined;
        newColIndex = undefined;
        newReferencePosCell = undefined;
      }
    }

    const newReferencePosTable = tableBody.getBoundingClientRect();
    const newReferencePosWrapper = this.tableElement.closest('.tableWrapper')?.getBoundingClientRect();
    const blockChanged = this.state.block !== tableInfo.node || this.state.blockPos !== tableInfo.pos;
    const indicesChanged = newRowIndex !== this.state.rowIndex || newColIndex !== this.state.colIndex;
    const refPosChanged = newReferencePosCell !== this.state.referencePosCell || newReferencePosTable !== this.state.referencePosTable;

    if (blockChanged || indicesChanged || refPosChanged) {
      this.state = {
        ...this.state,
        block: tableInfo.node,
        blockPos: tableInfo.pos,
        rowIndex: newRowIndex,
        colIndex: newColIndex,
        referencePosCell: newReferencePosCell,
        referencePosTable: newReferencePosTable,
        referencePosWrapper: newReferencePosWrapper,
      };
      this.emitUpdate();
    }
  }

  destroy() {
    this.editorView.dom.removeEventListener('mousemove', this._mouseMoveHandler);
    this.editorView.dom.removeEventListener('mousedown', this._viewMousedownHandler);
    window.removeEventListener('mouseup', this._mouseUpHandler);
    this.editorView.root.removeEventListener('dragover', this._dragOverHandler);
    this.editorView.root.removeEventListener('drop', this._dropHandler);
    window.removeEventListener('scroll', this._scrollHandler, true);
    if (this._resizeObserver) this._resizeObserver.disconnect();
    if (this._rafId != null) cancelAnimationFrame(this._rafId);
    this._rafId = null;
  }
}

let tableHandleView = null;

export function TableHandlePlugin(editor, emitUpdate) {
  return new Plugin({
    key: tableHandlePluginKey,

    state: {
      init: () => false,
      apply: (tr, frozen) => {
        const meta = tr.getMeta(tableHandlePluginKey);
        return meta !== undefined ? meta : frozen;
      },
    },

    view: (editorView) => {
      tableHandleView = new TableHandleView(editor, editorView, emitUpdate);
      return tableHandleView;
    },

    props: {
      decorations: (state) => {
        if (!tableHandleView || !tableHandleView.state || tableHandleView.state.draggingState === undefined || tableHandleView.tablePos === undefined) {
          return;
        }

        const newIndex = tableHandleView.state.draggingState.draggedCellOrientation === 'row'
          ? tableHandleView.state.rowIndex
          : tableHandleView.state.colIndex;

        if (newIndex === undefined) return;

        const decorations = [];
        const { draggingState } = tableHandleView.state;
        const { originalIndex } = draggingState;

        if (tableHandleView.state.draggingState.draggedCellOrientation === 'row') {
          const originalCells = getRowCells(editor, originalIndex, tableHandleView.state.blockPos);
          originalCells.cells.forEach((cell) => {
            if (cell.node) {
              decorations.push(Decoration.node(cell.pos, cell.pos + cell.node.nodeSize, { class: 'table-cell-dragging-source' }));
            }
          });
        } else {
          const originalCells = getColumnCells(editor, originalIndex, tableHandleView.state.blockPos);
          originalCells.cells.forEach((cell) => {
            if (cell.node) {
              decorations.push(Decoration.node(cell.pos, cell.pos + cell.node.nodeSize, { class: 'table-cell-dragging-source' }));
            }
          });
        }

        if (newIndex === originalIndex || !editor) {
          return DecorationSet.create(state.doc, decorations);
        }

        if (tableHandleView.state.draggingState.draggedCellOrientation === 'row') {
          const cellsInRow = getRowCells(editor, newIndex, tableHandleView.state.blockPos);
          cellsInRow.cells.forEach((cell) => {
            const cellNode = cell.node;
            if (!cellNode) return;
            const decorationPos = cell.pos + (newIndex > originalIndex ? cellNode.nodeSize - 2 : 2);
            decorations.push(Decoration.widget(decorationPos, () => {
              const widget = document.createElement('div');
              widget.className = 'tiptap-table-dropcursor';
              widget.style.left = '0';
              widget.style.right = '0';
              if (newIndex > originalIndex) {
                widget.style.bottom = '-1px';
              } else {
                widget.style.top = '-1px';
              }
              widget.style.height = '3px';
              return widget;
            }));
          });
        } else {
          const cellsInColumn = getColumnCells(editor, newIndex, tableHandleView.state.blockPos);
          cellsInColumn.cells.forEach((cell) => {
            const cellNode = cell.node;
            if (!cellNode) return;
            const decorationPos = cell.pos + (newIndex > originalIndex ? cellNode.nodeSize - 2 : 2);
            decorations.push(Decoration.widget(decorationPos, () => {
              const widget = document.createElement('div');
              widget.className = 'tiptap-table-dropcursor';
              widget.style.top = '0';
              widget.style.bottom = '0';
              if (newIndex > originalIndex) {
                widget.style.right = '-1px';
              } else {
                widget.style.left = '-1px';
              }
              widget.style.width = '3px';
              return widget;
            }));
          });
        }

        return DecorationSet.create(state.doc, decorations);
      },
    },
  });
}

const tableDragStart = (orientation, event, editor, _view) => {
  if (!tableHandleView?.state) return;

  const { state } = tableHandleView;
  const index = orientation === 'col' ? state.colIndex : state.rowIndex;
  if (index === undefined) return;

  const { blockPos, referencePosCell } = state;
  const mousePos = orientation === 'col' ? event.clientX : event.clientY;

  if (editor.state.selection instanceof CellSelection) {
    const safeSel = TextSelection.near(editor.state.doc.resolve(blockPos), 1);
    editor.view.dispatch(editor.state.tr.setSelection(safeSel));
  }

  const dragImage = createTableDragImage(editor, orientation, index, blockPos);

  if (event.dataTransfer) {
    const handleRect = event.currentTarget.getBoundingClientRect();
    const offset = orientation === 'col'
      ? { x: handleRect.width / 2, y: 0 }
      : { x: 0, y: handleRect.height / 2 };

    event.dataTransfer.effectAllowed = orientation === 'col' ? 'move' : 'copyMove';
    event.dataTransfer.setDragImage(dragImage, offset.x, offset.y);
    event.dataTransfer.setData('text/plain', '');
  }

  const cleanup = () => dragImage.parentNode?.removeChild(dragImage);
  document.addEventListener('drop', cleanup, { once: true });
  document.addEventListener('dragend', cleanup, { once: true });

  const initialOffset = referencePosCell
    ? (orientation === 'col' ? referencePosCell.left : referencePosCell.top) - mousePos
    : 0;

  tableHandleView.state = {
    ...state,
    draggingState: {
      draggedCellOrientation: orientation,
      originalIndex: index,
      mousePos,
      initialOffset,
    },
  };
  tableHandleView.emitUpdate();
  editor.view.dispatch(editor.state.tr.setMeta(tableHandlePluginKey, true));
};

export const colDragStart = (event, editor, view) => tableDragStart('col', event, editor, view);
export const rowDragStart = (event, editor, view) => tableDragStart('row', event, editor, view);

export const dragEnd = () => {
  if (!tableHandleView || tableHandleView.state === undefined) return;
  tableHandleView.state = { ...tableHandleView.state, draggingState: undefined };
  tableHandleView.emitUpdate();
  tableHandleView.editor.view.dispatch(tableHandleView.editor.state.tr.setMeta(tableHandlePluginKey, null));
};
