import { liftTarget, canSplit } from '@tiptap/pm/transform';
import { TextSelection } from '@tiptap/pm/state';
import {
  splitBlock,
  chainCommands,
  newlineInCode,
  createParagraphNear,
} from '@tiptap/pm/commands';
import { keymap } from '@tiptap/pm/keymap';

function findParentColumn($pos) {
  for (let depth = $pos.depth; depth > 0; depth--) {
    const node = $pos.node(depth);
    if (node.type.name === 'column') {
      return { node, depth };
    }
  }
  return null;
}

const isSuggestionOpen = () => {
  const popup = document.querySelector('.slash-tippy');
  return !!popup;
};

export const liftEmptyBlock = (state, dispatch) => {
  const { $cursor } = state.selection;
  if (!$cursor || $cursor.parent.content.size) return false;
  if ('column' === $cursor.node($cursor.depth - 1).type.name) return false;
  if ($cursor.depth > 1 && $cursor.after() != $cursor.end(-1)) {
    const before = $cursor.before();
    if (canSplit(state.doc, before)) {
      if (dispatch) dispatch(state.tr.split(before).scrollIntoView());
      return true;
    }
  }
  const range = $cursor.blockRange(),
    target = range && liftTarget(range);
  if (target == null) return false;
  if (dispatch) dispatch(state.tr.lift(range, target).scrollIntoView());
  return true;
};

const splitListItem = (listItem) => (state, dispatch) => {
  const { $from, $to } = state.selection;
  const node = $from.node($from.depth);
  const onTaskItem = node.type.name === 'taskItem';

  if (onTaskItem && $from.node($from.depth - 1).type.name !== 'taskList') {
    return false;
  }

  const inner = onTaskItem ? $from.node($from.depth - 2) : $from.node($from.depth - 1);
  if (!inner.type.spec.contains?.('listItem') && inner.type.name !== 'listItem') {
    return false;
  }

  if ($from.depth < (onTaskItem ? 3 : 2) || !$from.sameParent($to)) {
    return false;
  }

  const tr = state.tr;
  if (dispatch) {
    dispatch(tr.split($from.pos, 2, inner.contentMatchAt($from.index($from.depth - 1)).copy()));
  }
  return true;
};

export const columnsKeymap = keymap({
  Enter: (state, dispatch, view) => {
    if (isSuggestionOpen()) {
      return false;
    }

    const { $from } = state.selection;
    const lineText = $from.nodeBefore?.isText ? $from.nodeBefore.text : '';
    if (lineText && lineText.endsWith('```')) {
      return false;
    }

    const { listItem, taskItem } = state.schema.nodes;

    return chainCommands(
      newlineInCode,
      ...(listItem ? [splitListItem(listItem)] : []),
      ...(taskItem ? [splitListItem(taskItem)] : []),
      createParagraphNear,
      liftEmptyBlock,
      splitBlock
    )(state, dispatch, view);
  },
  'Mod-a': (state, dispatch) => {
    const { selection } = state;
    const { $from } = selection;
    const found = findParentColumn($from);
    if (found) {
      const { depth } = found;
      const start = $from.start(depth);
      const end = $from.end(depth);
      const tr = state.tr.setSelection(
        TextSelection.create(state.doc, start, end)
      );
      if (dispatch) dispatch(tr);
      return true;
    }
    return false;
  },
});