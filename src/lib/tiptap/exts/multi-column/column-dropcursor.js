import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';

const MAX_COLUMNS = 5;

const columnDropCursorPluginKey = new PluginKey('columnDropCursor');

export const ColumnDropCursor = Extension.create({
  name: 'columnDropCursor',

  addProseMirrorPlugins() {
    let cursorEl = null;

    const hideCursor = (view) => {
      if (cursorEl) cursorEl.style.display = 'none';
      view.dom.classList.remove('hide-native-dropcursor');
    };

    return [
      new Plugin({
        key: columnDropCursorPluginKey,
        view(view) {
          cursorEl = document.createElement('div');
          cursorEl.className = 'column-dropcursor';
          Object.assign(cursorEl.style, {
            position: 'absolute',
            display: 'none',
            pointerEvents: 'none',
            zIndex: '1000',
            width: '4px',
          });
          view.dom.parentElement?.appendChild(cursorEl);

          const onDragEnd = () => hideCursor(view);
          window.addEventListener('dragend', onDragEnd);

          return {
            destroy() {
              window.removeEventListener('dragend', onDragEnd);
              cursorEl?.remove();
              cursorEl = null;
            },
          };
        },
        props: {
          handleDOMEvents: {
            dragover: (view, event) => {
              const editorRect = view.dom.getBoundingClientRect();

              const target = document.elementFromPoint(
                event.clientX,
                event.clientY
              );
              const columnDOM = target?.closest('[data-type="column"]');

              if (columnDOM) {
                const rect = columnDOM.getBoundingClientRect();
                const isRightSide =
                  event.clientX > rect.right - rect.width * 0.4;

                if (isRightSide) {
                  event.preventDefault();
                  event.dataTransfer.dropEffect = 'move';

                  if (cursorEl) {
                    cursorEl.style.display = 'block';
                    cursorEl.style.height = `${rect.height}px`;
                    cursorEl.style.top = `${
                      view.dom.offsetTop + (rect.top - editorRect.top)
                    }px`;
                    cursorEl.style.left = `${
                      view.dom.offsetLeft +
                      (rect.left - editorRect.left) +
                      rect.width +
                      4
                    }px`;
                  }
                  view.dom.classList.add('hide-native-dropcursor');
                  return true;
                }
              }

              const middleX = editorRect.left + editorRect.width / 2;
              const topLevelTarget = document.elementFromPoint(
                middleX,
                event.clientY
              );
              const nodeDOM = topLevelTarget?.closest('.tiptap > *');

              if (
                nodeDOM &&
                !nodeDOM.matches('[data-type="column-container"]')
              ) {
                const rect = nodeDOM.getBoundingClientRect();
                const isRightSide =
                  event.clientX > rect.right - 40 && event.clientX < rect.right;

                if (isRightSide) {
                  event.preventDefault();
                  event.dataTransfer.dropEffect = 'move';
                  if (cursorEl) {
                    cursorEl.style.display = 'block';
                    cursorEl.style.height = `${rect.height}px`;
                    cursorEl.style.top = `${
                      view.dom.offsetTop + (rect.top - editorRect.top)
                    }px`;
                    cursorEl.style.left = `${
                      view.dom.offsetLeft +
                      (rect.left - editorRect.left) +
                      rect.width +
                      4
                    }px`;
                  }
                  view.dom.classList.add('hide-native-dropcursor');
                  return true;
                }
              }

              hideCursor(view);
              return false;
            },

            drop: (view, event) => {
              const dropTarget = document.elementFromPoint(
                event.clientX,
                event.clientY
              );
              const columnDOM = dropTarget?.closest('[data-type="column"]');

              const detectDOM = columnDOM || dropTarget?.closest('.tiptap > *');
              if (!detectDOM) return false;

              const rect = detectDOM.getBoundingClientRect();
              const isRightSide = event.clientX > rect.left + rect.width * 0.5;
              if (!isRightSide) return false;

              event.preventDefault();
              event.stopPropagation();
              hideCursor(view);

              const dragging = view.dragging;
              const slice = dragging?.slice;
              if (!slice) return false;

              const { state, dispatch } = view;
              const { column, columns } = state.schema.nodes;

              const isSourceColumns =
                slice.content.firstChild?.type.name === 'columns';
              const pos = view.posAtDOM(detectDOM, 0);
              const $pos = state.doc.resolve(pos);

              // When content is dragged FROM inside a column and dropped
              // outside (top-level), let the default ProseMirror handler
              // move it freely instead of re-wrapping it in columns.
              if (!columnDOM && dragging?.node && dragging.move) {
                const fromPos = dragging.node.from;
                if (fromPos !== undefined) {
                  const from$pos = state.doc.resolve(fromPos);
                  for (let d = from$pos.depth; d > 0; d--) {
                    if (from$pos.node(d).type.name === 'column') {
                      return false;
                    }
                  }
                }
              }

              let tr = state.tr;
              if (dragging.move) {
                const { from, to } = state.selection;
                tr.delete(from, to);
              }

              try {
                if (columnDOM) {
                  const insertPos = tr.mapping.map($pos.after($pos.depth));
                  const nodesToInsert = [];

                  if (isSourceColumns) {
                    const sourceCols = slice.content.firstChild;
                    if (sourceCols.content.childCount + 1 > MAX_COLUMNS) {
                      return false;
                    }
                    sourceCols.content.forEach((child) =>
                      nodesToInsert.push(child)
                    );
                  } else {
                    nodesToInsert.push(
                      column.create({ flexGrow: 1 }, slice.content)
                    );
                  }

                  tr.insert(insertPos, nodesToInsert);
                } else {
                  const actualTargetPos = tr.mapping.map($pos.before(1));
                  const targetNode = tr.doc.nodeAt(actualTargetPos);
                  if (!targetNode) return false;

                  if (isSourceColumns) {
                    const sourceColumnsNode = slice.content.firstChild;
                    if (
                      sourceColumnsNode.content.childCount + 1 >
                      MAX_COLUMNS
                    ) {
                      return false;
                    }
                    const columnsList = [
                      column.create({ flexGrow: 1 }, targetNode),
                    ];
                    sourceColumnsNode.content.forEach((child) =>
                      columnsList.push(child)
                    );
                    tr.replaceWith(
                      actualTargetPos,
                      actualTargetPos + targetNode.nodeSize,
                      columns.create(null, columnsList)
                    );
                  } else {
                    const container = columns.create(null, [
                      column.create({ flexGrow: 1 }, targetNode),
                      column.create({ flexGrow: 1 }, slice.content),
                    ]);
                    tr.replaceWith(
                      actualTargetPos,
                      actualTargetPos + targetNode.nodeSize,
                      container
                    );
                  }
                }

                view.dragging = null;
                if (dispatch) dispatch(tr);
                return true;
              } catch (e) {
                console.error('Column drop error:', e);
                return false;
              }
            },
          },
          handleDragLeave: (view) => hideCursor(view),
        },
      }),
    ];
  },
});
