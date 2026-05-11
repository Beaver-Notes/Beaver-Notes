import { EditorView } from '@tiptap/pm/view';

export function findBoundaryPosition(view, event, handleWidth) {
  const gridDOM = event
    .composedPath()
    .find(
      (el) =>
        el instanceof Element && el.matches('[data-type="column-container"]')
    );
  if (!gridDOM) return -1;

  const children = Array.from(gridDOM.children).filter((el) =>
    el.matches?.('[data-type="column"]')
  );
  for (let i = 0; i < children.length; i++) {
    const colEl = children[i];
    const rect = colEl.getBoundingClientRect();
    if (
      event.clientX >= rect.right - 11 &&
      event.clientX <= rect.right + 11
    ) {
      const pos = view.posAtDOM(colEl, 0);
      if (pos != null) {
        return pos;
      }
    }
  }

  return -1;
}

export function updateColumnNodeFlex(view, pos, flex) {
  const { state, dispatch } = view;
  const node = state.doc.nodeAt(pos);
  if (!node || node.type.name !== 'column') return;

  const roundedFlex = Math.round(flex * 100) / 100;

  dispatch(
    state.tr
      .setNodeMarkup(pos, undefined, {
        ...node.attrs,
        flexGrow: roundedFlex,
      })
      .setMeta('addToHistory', false)
  );
}

export function getColumnInfoAtPos(view, boundaryPos) {
  const $pos = view.state.doc.resolve(boundaryPos);
  const node = $pos.parent;
  if (!node || node.type.name !== 'column') return null;

  const dom = view.domAtPos($pos.pos);
  if (!dom.node) return null;

  const columnEl =
    dom.node instanceof HTMLElement
      ? dom.node
      : dom.node.childNodes[dom.offset];

  const domWidth = columnEl.offsetWidth;

  return { $pos, node, columnEl, domWidth };
}