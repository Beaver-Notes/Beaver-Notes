

function styleDragWrapper(el, maxWidth) {
  Object.assign(el.style, {
    position: 'fixed',
    top: '-10000px',
    left: '-10000px',
    pointerEvents: 'none',
    zIndex: '2147483647',
    maxWidth: maxWidth + 'px',
    borderRadius: '12px',
    background: 'transparent',
    filter: 'drop-shadow(0 8px 24px rgba(0,0,0,0.18)) drop-shadow(0 2px 8px rgba(0,0,0,0.10))',
    overflow: 'hidden',
  });
}

function scaleToFit(el, maxWidth, host) {
  if (!el.isConnected) host.appendChild(el);
  const rect = el.getBoundingClientRect();
  if (rect.width > maxWidth && rect.width > 0) {
    const scale = maxWidth / rect.width;
    el.style.transformOrigin = 'top left';
    el.style.transform = 'scale(' + scale + ')';
  }
}

function applyTableBoxStyles(srcTable, dstTable) {
  const tcs = getComputedStyle(srcTable);
  dstTable.style.borderCollapse = tcs.borderCollapse;
  dstTable.style.borderSpacing = tcs.borderSpacing;
  dstTable.style.tableLayout = 'fixed';
  dstTable.className = srcTable.className;
}

function lockCellWidth(fromCell, toCell) {
  const rect = fromCell.getBoundingClientRect();
  if (rect.width > 0) {
    toCell.style.width = rect.width + 'px';
    toCell.style.maxWidth = rect.width + 'px';
  }
  // The ghost shows one truncated line per cell, like the styled copy it replaces.
  for (const el of [toCell, ...toCell.querySelectorAll('p')]) {
    el.style.whiteSpace = 'nowrap';
    el.style.overflow = 'hidden';
    el.style.textOverflow = 'ellipsis';
  }
}

function buildRowPreview(tableEl, rowIndex) {
  const body = tableEl.tBodies?.[0] ?? tableEl.querySelector('tbody');
  if (!body) return null;
  const row = body.rows?.[rowIndex];
  if (!row) return null;

  const tableClone = document.createElement('table');
  const tbodyClone = document.createElement('tbody');
  const rowClone = row.cloneNode(true);
  applyTableBoxStyles(tableEl, tableClone);

  for (let i = 0; i < row.cells.length; i++) {
    const src = row.cells[i];
    const dst = rowClone.cells[i];
    if (dst) lockCellWidth(src, dst);
  }

  tbodyClone.appendChild(rowClone);
  tableClone.appendChild(tbodyClone);
  return tableClone;
}

function buildColumnPreview(tableEl, colIndex) {
  const body = tableEl.tBodies?.[0] ?? tableEl.querySelector('tbody');
  if (!body) return null;

  const tableClone = document.createElement('table');
  const tbodyClone = document.createElement('tbody');
  applyTableBoxStyles(tableEl, tableClone);

  let firstCellWidth = 0;

  for (let r = 0; r < body.rows.length; r++) {
    const srcRow = body.rows[r];
    if (!srcRow) continue;
    const srcCell = srcRow.cells?.[colIndex];
    if (!srcCell) continue;

    const tr = document.createElement('tr');
    const cellClone = srcCell.cloneNode(true);
    const rect = srcCell.getBoundingClientRect();
    if (!firstCellWidth && rect.width > 0) firstCellWidth = rect.width;
    lockCellWidth(srcCell, cellClone);
    tr.appendChild(cellClone);
    tbodyClone.appendChild(tr);
  }

  if (firstCellWidth > 0) {
    tableClone.style.width = firstCellWidth + 'px';
    tableClone.style.maxWidth = firstCellWidth + 'px';
  }

  tableClone.appendChild(tbodyClone);
  return tableClone;
}

export function createTableDragImage(editor, orientation, index, tablePos) {
  const editorRect = editor.view.dom.getBoundingClientRect();
  const maxWidth = Math.max(0, editorRect.width);

  const wrapper = document.createElement('div');
  // The ghost is detached from the editor, so it needs the editor classes to keep
  // the table and paragraph styles the copied cells rely on.
  wrapper.className = 'ProseMirror table-drag-ghost';
  styleDragWrapper(wrapper, maxWidth);
  // The editor content container carries the prose styles (table font size, text
  // color); hosting the ghost there keeps it looking like the source row.
  const host = editor.view.dom.parentElement || document.body;

  const tableEl = editor.view.nodeDOM(tablePos);
  if (!tableEl) {
    host.appendChild(wrapper);
    return wrapper;
  }

  const tableRect = tableEl.getBoundingClientRect();
  const dragWidth = Math.min(tableRect.width, editorRect.width);
  wrapper.style.width = dragWidth + 'px';

  const preview = orientation === 'row' ? buildRowPreview(tableEl, index) : buildColumnPreview(tableEl, index);

  if (preview) {
    const card = document.createElement('div');
    Object.assign(card.style, { background: 'var(--drag-image-bg, transparent)', overflow: 'hidden' });
    card.appendChild(preview);
    wrapper.appendChild(card);
  }

  scaleToFit(wrapper, maxWidth, host);
  return wrapper;
}
