/**
 * inkPaper.js — compose paperCore + ink specifics (REDESIGN phase E).
 *
 * Wires paperCore (gesture state machine) with:
 *  - useInkInput: gesture-scoped scribble suppression + chrome lock (A7/A8)
 *  - recognizer.js: shape hold-to-snap (used inside paperCore's commit)
 *  - double-tap-insert.js: pencil handoff (setPendingHandoff/takePendingHandoff)
 *  - imageMarkup.js: image-markup entry point
 *
 * Returns the paperCore API plus scribble handling (`beginStroke`, `endStroke`,
 * `strokeActive`, `finding`, `cleanup`).
 */

import { createPaperCore } from './paperCore.js';
import { useInkInput } from '@/composable/useInkInput.js';
import {
  setPendingHandoff,
  takePendingHandoff,
  createPaperInsertPlugin,
  PaperInsert,
} from './double-tap-insert.js';
import { mountImageMarkup } from './imageMarkup.js';

export function createInkPaper({
  container,
  drawing,
  live,
  onCommit = () => {},
  onUpdateStrokes = () => {},
  onHeightChange = () => {},
  onFocusRequest = () => {},
  tool = 'pen',
  toolSettings = {},
  height = 210,
  focused = false,
  dpr,
  isFinding,
} = {}) {
  const inkInput = useInkInput({ isFinding });

  const coreGestureId = { value: null };
  const core = createPaperCore({
    container,
    drawing,
    live,
    tool,
    toolSettings,
    height,
    focused,
    dpr,
    onCommit: (stroke) => {
      onCommit(stroke);
    },
    onUpdateStrokes,
    onHeightChange,
    onFocusRequest,
  });

  const origDown = core.onPointerDown;
  const origUp = core.onPointerUp;

  core.onPointerDown = (e) => {
    const id = `gesture-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    coreGestureId.value = id;
    if (!inkInput.beginStroke(id)) return; // find mode / already stroking
    origDown(e);
  };

  core.onPointerUp = (e) => {
    origUp(e);
    inkInput.endStroke(coreGestureId.value);
    coreGestureId.value = null;
  };

  return {
    ...core,
    beginStroke: inkInput.beginStroke,
    endStroke: inkInput.endStroke,
    strokeActive: inkInput.strokeActive,
    finding: inkInput.finding,
    cleanup: () => {
      core.destroy();
      inkInput.cleanup();
    },
    setPendingHandoff,
    takePendingHandoff,
    createPaperInsertPlugin,
    PaperInsert,
    mountImageMarkup,
  };
}
