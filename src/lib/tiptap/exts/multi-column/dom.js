import { TextSelection } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { gridResizingPluginKey } from './state.js';
import {
  findBoundaryPosition,
  getColumnInfoAtPos,
} from './utils.js';

const SNAP_PRESETS = [
  [0.5, 0.5],
  [0.6, 0.4],
  [0.7, 0.3],
  [0.8, 0.2],
  [0.4, 0.6],
  [0.3, 0.7],
  [0.2, 0.8],
];

const SNAP_TOLERANCE = 0.06;

function snapPair(leftRatio, rightRatio) {
  for (const [l, r] of SNAP_PRESETS) {
    if (
      Math.abs(leftRatio - l) < SNAP_TOLERANCE &&
      Math.abs(rightRatio - r) < SNAP_TOLERANCE
    ) {
      return [l, r];
    }
  }
  return null;
}

function snapColumnsOnFinish(view, dragging) {
  if (dragging.nextColPos === null) return;

  const leftNode = view.state.doc.nodeAt(dragging.nodePos);
  const rightNode = view.state.doc.nodeAt(dragging.nextColPos);
  if (!leftNode || !rightNode) return;

  const leftFlex = leftNode.attrs.flexGrow || 1;
  const rightFlex = rightNode.attrs.flexGrow || 1;
  const total = leftFlex + rightFlex;

  const snapped = snapPair(leftFlex / total, rightFlex / total);
  if (!snapped) return;

  const newLeft = Math.round(snapped[0] * total * 100) / 100;
  const newRight = Math.round(snapped[1] * total * 100) / 100;

  if (newLeft === leftFlex && newRight === rightFlex) return;

  const tr = view.state.tr;
  tr.setNodeMarkup(dragging.nodePos, undefined, {
    ...leftNode.attrs,
    flexGrow: newLeft,
  });
  tr.setNodeMarkup(dragging.nextColPos, undefined, {
    ...rightNode.attrs,
    flexGrow: newRight,
  });
  view.dispatch(tr.setMeta('addToHistory', true));
}

function updateActiveHandle(view, value) {
  view.dispatch(
    view.state.tr.setMeta(gridResizingPluginKey, {
      setHandle: value,
    })
  );
}

export function handleMouseMove(view, event, handleWidth) {
  const pluginState = gridResizingPluginKey.getState(view.state);

  if (!pluginState || pluginState.dragging) return false;

  const boundaryPos = findBoundaryPosition(view, event, handleWidth);

  if (boundaryPos !== pluginState.activeHandle) {
    updateActiveHandle(view, boundaryPos);
  }
  return false;
}

export function handleMouseLeave(view) {
  const pluginState = gridResizingPluginKey.getState(view.state);
  if (!pluginState) return false;
  if (pluginState.activeHandle > -1 && !pluginState.dragging) {
    updateActiveHandle(view, -1);
  }
  return false;
}

export function handleMouseDown(view, event, minFlex = 0.1) {
  const pluginState = gridResizingPluginKey.getState(view.state);

  if (
    !pluginState ||
    pluginState.activeHandle === -1 ||
    pluginState.dragging
  ) {
    return false;
  }

  const columnInfo = getColumnInfoAtPos(view, pluginState.activeHandle);
  if (!columnInfo) return false;

  const { $pos, node, columnEl } = columnInfo;
  const nodePos = $pos.before();
  const containerEl = columnEl.parentElement;

  if (!containerEl) return false;

  const nextColPos = nodePos + node.nodeSize;
  const nextNode = view.state.doc.nodeAt(nextColPos);
  const hasNext = nextNode && nextNode.type.name === 'column';

  let totalFlex = 0;
  $pos.parent.forEach((child) => {
    totalFlex += child.attrs.flexGrow || 1;
  });

  const containerWidth = containerEl.offsetWidth;

  view.dispatch(
    view.state.tr.setMeta(gridResizingPluginKey, {
      setDragging: {
        startX: event.clientX,
        startFlex: node.attrs.flexGrow || 1,
        nextColFlex: hasNext ? nextNode.attrs.flexGrow || 1 : null,
        nextColPos: hasNext ? nextColPos : null,
        nodePos: nodePos,
        totalFlex: totalFlex,
        containerWidth: containerWidth,
        didMove: false,
      },
    })
  );

  const win = view.dom.ownerDocument.defaultView || window;

  const move = (e) => {
    if (!e.buttons) {
      finish();
      return;
    }

    const currentState = gridResizingPluginKey.getState(view.state);
    const dragging = currentState?.dragging;
    if (!dragging) return;

    if (!dragging.didMove) {
      view.dispatch(
        view.state.tr.setMeta(gridResizingPluginKey, {
          setDragging: { ...dragging, didMove: true },
        })
      );
    }

    const {
      startX,
      startFlex,
      nextColFlex,
      nextColPos,
      totalFlex,
      containerWidth,
    } = dragging;

    const deltaX = e.clientX - startX;
    const deltaFlex = (deltaX / containerWidth) * totalFlex;

    const tr = view.state.tr;

    let newLeftFlex = Math.max(minFlex, startFlex + deltaFlex);

    if (nextColPos !== null && nextColFlex !== null) {
      const pairTotalFlex = startFlex + nextColFlex;
      let newRightFlex = Math.max(minFlex, pairTotalFlex - newLeftFlex);
      newLeftFlex = pairTotalFlex - newRightFlex;

      tr.setNodeMarkup(nodePos, undefined, {
        ...node.attrs,
        flexGrow: newLeftFlex,
      });

      const rightNode = view.state.doc.nodeAt(nextColPos);
      if (rightNode && rightNode.type.name === 'column') {
        tr.setNodeMarkup(nextColPos, undefined, {
          ...rightNode.attrs,
          flexGrow: newRightFlex,
        });
      }
    } else {
      tr.setNodeMarkup(nodePos, undefined, {
        ...node.attrs,
        flexGrow: newLeftFlex,
      });
    }

    view.dispatch(tr.setMeta('addToHistory', false));
  };

  const finish = () => {
    win.removeEventListener('mouseup', finish);
    win.removeEventListener('mousemove', move);

    const state = gridResizingPluginKey.getState(view.state);
    if (state?.dragging?.didMove) {
      snapColumnsOnFinish(view, state.dragging);
    }

    view.dispatch(
      view.state.tr.setMeta(gridResizingPluginKey, { setDragging: null })
    );
  };

  win.addEventListener('mouseup', finish);
  win.addEventListener('mousemove', move);

  event.preventDefault();
  return true;
}

export function handleGridDecorations(state, boundaryPos) {
  const $pos = state.doc.resolve(boundaryPos);

  if ($pos.nodeAfter === null) return DecorationSet.empty;

  const widget = Decoration.widget(
    boundaryPos,
    () => {
      const widgetDom = document.createElement('div');
      widgetDom.className = 'grid-resize-handle';
      widgetDom.dataset.action = 'add-or-resize';

      const resizeBar = document.createElement('div');
      resizeBar.className = 'resize-bar';

      const addButton = document.createElement('div');
      addButton.className = 'add-button';

      const plusIcon = document.createElement('div');
      plusIcon.className = 'plus-icon';

      addButton.appendChild(plusIcon);
      widgetDom.appendChild(resizeBar);
      widgetDom.appendChild(addButton);

      return widgetDom;
    },
    {
      key: `grid-handle-${boundaryPos}`,
      side: 0,
    }
  );

  return DecorationSet.create(state.doc, [widget]);
}

const MAX_COLUMNS = 5;

export function handleMouseUp(view, event) {
  const div = event.target;
  if (!div) return false;

  const resizeZone = div.closest('[data-action="add-or-resize"]');
  if (!resizeZone) return false;

  const pluginState = gridResizingPluginKey.getState(view.state);
  if (pluginState?.dragging?.didMove) return false;

  const column = div.closest('[data-type="column"]');
  if (!column) return false;

  const boundryPos = view.posAtDOM(column, 0);
  if (!boundryPos) return false;

  const { state } = view;
  const $pos = state.doc.resolve(boundryPos);
  const { column: columnType, paragraph: paragraphType } = state.schema.nodes;

  const container = $pos.parent;
  if (container.type.name === 'columns') {
    const currentCount = container.childCount;
    if (currentCount >= MAX_COLUMNS) {
      return true;
    }
  }

  const insertPos = $pos.after($pos.depth);
  const newColumn = columnType.create({ flexGrow: 1 }, paragraphType.create());

  const tr = state.tr.insert(insertPos, newColumn);

  const resolveNewPos = tr.doc.resolve(insertPos + 2);
  const selection = TextSelection.near(resolveNewPos);

  view.dispatch(tr.setSelection(selection).scrollIntoView());
  view.focus();

  return true;
}
