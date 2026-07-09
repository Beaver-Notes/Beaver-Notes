import { TableMap, cellAround, CellSelection, selectedRect, selectionCell, findTable } from '@tiptap/pm/tables';
import { Mapping } from '@tiptap/pm/transform';
import { Selection } from '@tiptap/pm/state';

export const RESIZE_MIN_WIDTH = 35;
export const EMPTY_CELL_WIDTH = 120;
export const EMPTY_CELL_HEIGHT = 40;

export function isHTMLElement(n) {
  return n instanceof HTMLElement;
}

export function safeClosest(start, selector) {
  return start?.closest?.(selector) ?? null;
}

export function domCellAround(target) {
  let current = target;
  while (
    current &&
    current.tagName !== 'TD' &&
    current.tagName !== 'TH' &&
    !current.classList.contains('tableWrapper')
  ) {
    if (current.classList.contains('ProseMirror')) return undefined;
    current = isHTMLElement(current.parentNode) ? current.parentNode : null;
  }
  if (!current) return undefined;
  if (current.tagName === 'TD' || current.tagName === 'TH') {
    return {
      type: 'cell',
      domNode: current,
      tbodyNode: safeClosest(current, 'tbody'),
    };
  }
  return {
    type: 'wrapper',
    domNode: current,
    tbodyNode: current.querySelector('tbody'),
  };
}

export function clamp(value, min, max) {
  return Math.max(min, Math.min(value, max));
}

export function isCellEmpty(cellNode) {
  if (cellNode.childCount === 0) return true;
  let isEmpty = true;
  cellNode.descendants((n) => {
    if (n.isText && n.text?.trim()) {
      isEmpty = false;
      return false;
    }
    if (n.isLeaf && !n.isText) {
      isEmpty = false;
      return false;
    }
    return true;
  });
  return isEmpty;
}

export function getTable(editor, tablePos) {
  if (!editor) return null;
  let table = null;
  if (typeof tablePos === 'number') {
    const tableNode = editor.state.doc.nodeAt(tablePos);
    if (tableNode?.type.name === 'table') {
      table = {
        node: tableNode,
        pos: tablePos,
        start: tablePos + 1,
        depth: editor.state.doc.resolve(tablePos).depth,
      };
    }
  }
  if (!table) {
    const $from = editor.state.doc.resolve(editor.state.selection.from);
    table = findTable($from);
  }
  if (!table) return null;
  const tableMap = TableMap.get(table.node);
  if (!tableMap) return null;
  return { ...table, map: tableMap };
}

export function getRowCells(editor, rowIndex, tablePos) {
  return collectCells(editor, 'row', rowIndex, tablePos);
}

export function getColumnCells(editor, columnIndex, tablePos) {
  return collectCells(editor, 'column', columnIndex, tablePos);
}

function collectCells(editor, orientation, index, tablePos) {
  if (!editor) return { cells: [], mergedCells: [] };
  const table = getTable(editor, tablePos);
  if (!table) return { cells: [], mergedCells: [] };
  const tableStart = table.start;
  const tableNode = table.node;
  const map = table.map;
  const resolvedIndex = resolveOrientationIndex(editor.state, table, orientation, index);
  if (resolvedIndex === null) return { cells: [], mergedCells: [] };
  const maxIndex = orientation === 'row' ? map.height : map.width;
  if (resolvedIndex < 0 || resolvedIndex >= maxIndex) return { cells: [], mergedCells: [] };
  const cells = [];
  const mergedCells = [];
  const seenMerged = new Set();
  const iterationCount = orientation === 'row' ? map.width : map.height;
  for (let i = 0; i < iterationCount; i++) {
    const row = orientation === 'row' ? resolvedIndex : i;
    const col = orientation === 'row' ? i : resolvedIndex;
    const cellIndex = row * map.width + col;
    const mapCell = map.map[cellIndex];
    if (mapCell === undefined) continue;
    const cellPos = tableStart + mapCell;
    const cellNode = tableNode.nodeAt(mapCell);
    if (!cellNode) continue;
    const cellInfo = { pos: cellPos, node: cellNode, start: cellPos + 1, depth: cellNode.content.size, row, column: col };
    const colspan = cellNode.attrs.colspan ?? 1;
    const rowspan = cellNode.attrs.rowspan ?? 1;
    if ((colspan > 1 || rowspan > 1) && !seenMerged.has(cellPos)) {
      mergedCells.push(cellInfo);
      seenMerged.add(cellPos);
    }
    cells.push(cellInfo);
  }
  return { cells, mergedCells };
}

function resolveOrientationIndex(state, table, orientation, providedIndex) {
  if (typeof providedIndex === 'number') return providedIndex;
  if (state.selection instanceof CellSelection) {
    const rect = selectedRect(state);
    return orientation === 'row' ? rect.top : rect.left;
  }
  const $cell = cellAround(state.selection.$anchor) ?? selectionCell(state);
  if (!$cell) return null;
  const rel = $cell.pos - table.start;
  const rect = table.map.findCell(rel);
  return orientation === 'row' ? rect.top : rect.left;
}

export function isTableNode(node) {
  return !!node && (node.type.name === 'table' || node.type.spec?.tableRole === 'table');
}

export function getCellIndicesFromDOM(cell, tableNode, editor) {
  if (!tableNode) return null;
  try {
    const cellPos = editor.view.posAtDOM(cell, 0);
    const $cellPos = editor.view.state.doc.resolve(cellPos);
    for (let d = $cellPos.depth; d > 0; d--) {
      const node = $cellPos.node(d);
      if (node.type.name === 'tableCell' || node.type.name === 'tableHeader') {
        const tableMap = TableMap.get(tableNode);
        const cellNodePos = $cellPos.before(d);
        const tableStart = $cellPos.start(d - 2);
        const cellOffset = cellNodePos - tableStart;
        const cellIndex = tableMap.map.indexOf(cellOffset);
        return {
          rowIndex: Math.floor(cellIndex / tableMap.width),
          colIndex: cellIndex % tableMap.width,
        };
      }
    }
  } catch (e) {
    console.warn('Could not get cell position:', e);
  }
  return null;
}

export function getTableFromDOM(tableElement, editor) {
  try {
    const pos = editor.view.posAtDOM(tableElement, 0);
    const $pos = editor.view.state.doc.resolve(pos);
    for (let d = $pos.depth; d >= 0; d--) {
      const node = $pos.node(d);
      if (isTableNode(node)) {
        return { node, pos: d === 0 ? 0 : $pos.before(d) };
      }
    }
  } catch (e) {
    console.warn('Could not get table from DOM:', e);
  }
  return null;
}

export function getIndexCoordinates({ editor, index, orientation, tablePos }) {
  if (!editor) return null;
  const table = getTable(editor, tablePos);
  if (!table) return null;
  const { map } = table;
  const { width, height } = map;
  if (index < 0) return null;
  if (orientation === 'row' && index >= height) return null;
  if (orientation === 'column' && index >= width) return null;
  return orientation === 'row'
    ? Array.from({ length: map.width }, (_, col) => ({ row: index, col }))
    : Array.from({ length: map.height }, (_, row) => ({ row, col: index }));
}

export function selectCellsByCoords(editor, tablePos, coords, options = { mode: 'state' }) {
  const table = getTable(editor, tablePos);
  if (!table) return;
  const { state } = editor;
  const tableMap = table.map;
  const cleanedCoords = coords
    .map((c) => ({ row: clamp(c.row, 0, tableMap.height - 1), col: clamp(c.col, 0, tableMap.width - 1) }))
    .filter((c) => c.row >= 0 && c.row < tableMap.height && c.col >= 0 && c.col < tableMap.width);
  if (cleanedCoords.length === 0) return;
  const allRows = cleanedCoords.map((c) => c.row);
  const topRow = Math.min(...allRows);
  const bottomRow = Math.max(...allRows);
  const allCols = cleanedCoords.map((c) => c.col);
  const leftCol = Math.min(...allCols);
  const rightCol = Math.max(...allCols);
  const getCellPositionFromMap = (row, col) => {
    const cellOffset = tableMap.map[row * tableMap.width + col];
    if (cellOffset === undefined) return null;
    return tablePos + 1 + cellOffset;
  };
  const anchorPosition = getCellPositionFromMap(topRow, leftCol);
  if (anchorPosition === null) return;
  let headPosition = getCellPositionFromMap(bottomRow, rightCol);
  if (headPosition === null) return;
  if (headPosition === anchorPosition) {
    let found = false;
    for (let row = bottomRow; row >= topRow && !found; row--) {
      for (let col = rightCol; col >= leftCol && !found; col--) {
        const cp = getCellPositionFromMap(row, col);
        if (cp !== null && cp !== anchorPosition) {
          headPosition = cp;
          found = true;
        }
      }
    }
  }
  try {
    const anchorRef = state.doc.resolve(anchorPosition);
    const headRef = state.doc.resolve(headPosition);
    const cellSelection = new CellSelection(anchorRef, headRef);
    const transaction = state.tr.setSelection(cellSelection);
    const mode = options.mode || 'state';
    if (mode === 'dispatch' && options.dispatch) {
      options.dispatch(transaction);
      return;
    }
    if (mode === 'transaction') return transaction;
    return state.apply(transaction);
  } catch (e) {
    console.error('Failed to create cell selection:', e);
  }
}

export function selectLastCell(editor, tableNode, tablePos, orientation) {
  const map = TableMap.get(tableNode);
  const isRow = orientation === 'row';
  const row = isRow ? map.height - 1 : 0;
  const col = isRow ? 0 : map.width - 1;
  const index = row * map.width + col;
  const cellPos = map.map[index];
  if (cellPos === undefined) return false;
  const cellIndex = map.map.indexOf(cellPos);
  const actualRow = cellIndex >= 0 ? Math.floor(cellIndex / map.width) : 0;
  const actualCol = cellIndex >= 0 ? cellIndex % map.width : 0;
  return selectCellAt({ editor, row: actualRow, col: actualCol, tablePos, dispatch: editor.view.dispatch.bind(editor.view) });
}

export function selectCellAt({ editor, row, col, tablePos, dispatch }) {
  if (!editor) return false;
  const { state, view } = editor;
  const found = getTable(editor, tablePos);
  if (!found) return false;
  if (row < 0 || row >= found.map.height || col < 0 || col >= found.map.width) return false;
  const relCellPos = found.map.positionAt(row, col, found.node);
  const absCellPos = found.start + relCellPos;
  const $abs = state.doc.resolve(absCellPos);
  const $cell = cellAround($abs);
  const cellPos = $cell ? $cell.pos : absCellPos;
  const sel = CellSelection.create(state.doc, cellPos);
  const doDispatch = dispatch ?? view?.dispatch;
  if (!doDispatch) return false;
  doDispatch(state.tr.setSelection(sel));
  return true;
}

export function runPreservingCursor(editor, fn) {
  const view = editor.view;
  const startSel = view.state.selection;
  const bookmark = startSel.getBookmark();
  const mapping = new Mapping();
  const originalDispatch = view.dispatch;
  view.dispatch = (tr) => {
    mapping.appendMapping(tr.mapping);
    originalDispatch(tr);
  };
  try {
    fn();
  } finally {
    view.dispatch = originalDispatch;
  }
  try {
    const sel = bookmark.map(mapping).resolve(view.state.doc);
    view.dispatch(view.state.tr.setSelection(sel));
    return true;
  } catch {
    const mappedPos = mapping.map(startSel.from, -1);
    const clamped = clamp(mappedPos, 0, view.state.doc.content.size);
    const near = Selection.near(view.state.doc.resolve(clamped), -1);
    view.dispatch(view.state.tr.setSelection(near));
    return false;
  }
}

export function countEmptyRowsFromEnd(editor, tablePos) {
  return countEmptyCellsFromEnd(editor, tablePos, 'row');
}

export function countEmptyColumnsFromEnd(editor, tablePos) {
  return countEmptyCellsFromEnd(editor, tablePos, 'column');
}

function countEmptyCellsFromEnd(editor, tablePos, orientation) {
  const table = getTable(editor, tablePos);
  if (!table) return 0;
  const { doc } = editor.state;
  const maxIndex = orientation === 'row' ? table.map.height : table.map.width;
  let emptyCount = 0;
  for (let idx = maxIndex - 1; idx >= 0; idx--) {
    const seen = new Set();
    let isLineEmpty = true;
    const iterationCount = orientation === 'row' ? table.map.width : table.map.height;
    for (let i = 0; i < iterationCount; i++) {
      const row = orientation === 'row' ? idx : i;
      const col = orientation === 'row' ? i : idx;
      const rel = table.map.positionAt(row, col, table.node);
      if (seen.has(rel)) continue;
      seen.add(rel);
      const abs = tablePos + 1 + rel;
      const cell = doc.nodeAt(abs);
      if (!cell) continue;
      if (!isCellEmpty(cell)) {
        isLineEmpty = false;
        break;
      }
    }
    if (isLineEmpty) emptyCount++;
    else break;
  }
  return emptyCount;
}

export function marginRound(num, margin = 0.3) {
  const floor = Math.floor(num);
  const ceil = Math.ceil(num);
  const lowerBound = floor + margin;
  const upperBound = ceil - margin;
  if (num < lowerBound) return floor;
  if (num > upperBound) return ceil;
  return Math.round(num);
}

export function rectEq(a, b) {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return a.left === b.left && a.top === b.top && a.width === b.width && a.height === b.height;
}

const CLIP_OVERFLOW_VALUES = ['auto', 'scroll', 'hidden', 'clip'];

// Walk up from a cell to the ancestors that actually clip it
// (e.g. .tableWrapper with overflow-x: auto).
export function getClipContainers(el) {
  const out = [];
  let node = el ? el.parentElement : null;
  while (node && node.nodeType === 1) {
    const cs = getComputedStyle(node);
    if (CLIP_OVERFLOW_VALUES.includes(cs.overflowX) || CLIP_OVERFLOW_VALUES.includes(cs.overflowY)) {
      out.push(node);
    }
    if (node === document.documentElement || node === document.body) break;
    node = node.parentElement;
  }
  return out;
}

// Returns the portion of `rect` that is actually visible inside the viewport
// and every clipping scroll container, or null when fully hidden. Cells
// partially clipped by an overflow container (e.g. 1/3 hidden) keep showing
// the visible part instead of disappearing.
export function computeVisibleRect(rect, el) {
  if (!rect) return null;
  const vw = window.innerWidth || document.documentElement.clientWidth;
  const vh = window.innerHeight || document.documentElement.clientHeight;

  let left = Math.max(rect.left, 0);
  let top = Math.max(rect.top, 0);
  let right = Math.min(rect.right, vw);
  let bottom = Math.min(rect.bottom, vh);
  if (right <= left || bottom <= top) return null;

  for (const c of getClipContainers(el)) {
    const cr = c.getBoundingClientRect();
    const cLeft = Math.max(left, cr.left);
    const cTop = Math.max(top, cr.top);
    const cRight = Math.min(right, cr.right);
    const cBottom = Math.min(bottom, cr.bottom);
    if (cRight <= cLeft || cBottom <= cTop) return null;
    left = cLeft;
    top = cTop;
    right = cRight;
    bottom = cBottom;
  }

  return new DOMRect(left, top, right - left, bottom - top);
}

export const TABLE_COLOR_SWATCHES = [
  '#DC8D42',
  '#E3B324',
  '#4CAF50',
  '#3A8EE6',
  '#9B5EE6',
  '#E67EA4',
  '#E75C5C',
];

export const TABLE_ALIGN_OPTIONS = [
  { value: 'left', label: 'Align left', icon: 'riAlignLeft' },
  { value: 'center', label: 'Align center', icon: 'riAlignCenter' },
  { value: 'right', label: 'Align right', icon: 'riAlignRight' },
];
