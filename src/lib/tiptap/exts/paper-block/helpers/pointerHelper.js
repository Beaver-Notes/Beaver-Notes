/** Pointer handling via lightweight state machine: idle to pointing to drawing/erasing/selecting/transforming to idle. */

import {
  isPalmTouch,
  isDeliberateInput,
  isPen,
  isStylusEraser,
  getPointerCoordinates,
  normalisePressure,
  getCoalescedEvents,
} from './drawHelper.js';

// Segment-split eraser

function splitStrokeByEraser(stroke, eraserX, eraserY, eraserRadius) {
  const pts = stroke.points;
  if (!pts || pts.length === 0) return [stroke];

  // Expand hit radius by the rendered stroke width so the eraser catches
  // visible ink, not just raw point coordinates.
  const strokeR = (stroke.size ?? 4) / 2;
  const effectiveR = eraserRadius + strokeR;
  const r2 = effectiveR * effectiveR;

  const hit = new Uint8Array(pts.length);
  for (let i = 0; i < pts.length; i++) {
    const dx = pts[i][0] - eraserX;
    const dy = pts[i][1] - eraserY;
    if (dx * dx + dy * dy <= r2) hit[i] = 1;
  }

  if (!hit.some(Boolean)) return [stroke];

  // Also mark one extra point on each side of hits to make clean cuts
  for (let i = 1; i < pts.length - 1; i++) {
    if (!hit[i] && (hit[i - 1] || hit[i + 1])) hit[i] = 1;
  }

  const result = [];
  let segment = [];

  for (let i = 0; i < pts.length; i++) {
    if (!hit[i]) {
      segment.push(pts[i]);
    } else {
      if (segment.length >= 2) {
        result.push({
          ...stroke,
          id: `${stroke.id}_s${result.length}`,
          points: segment,
        });
      }
      segment = [];
    }
  }
  if (segment.length >= 2) {
    result.push({
      ...stroke,
      id: `${stroke.id}_s${result.length}`,
      points: segment,
    });
  }

  return result;
}

function applyEraserPoint(lines, x, y, radius) {
  let changed = false;
  const next = [];

  for (const stroke of lines) {
    const parts = splitStrokeByEraser(stroke, x, y, radius);
    if (parts.length !== 1 || parts[0] !== stroke) changed = true;
    next.push(...parts);
  }

  return changed ? next : lines;
}

/**
 * TouchMode (from tldraw). 'pointing' = pointer down but not yet past
 * the drag threshold; the other names match their modes.
 */
const TouchMode = {
  IDLE: 'idle',
  POINTING: 'pointing',
  DRAWING: 'drawing',
  ERASING: 'erasing',
  SELECTING: 'selecting',
  TRANSFORMING: 'transforming',
};

const DRAG_THRESHOLD_SQ = 9; // 3px squared: minimum drag to start drawing.

export function usePointerHelper(context) {
  const {
    state,
    svgRef,
    currentPointsRef,
    animationFrameRef,
    getSettings,
    handleSelectionStart,
    handleSelectionMove,
    handleSelectionEnd,
    handleTransformStart,
    handleTransformMove,
    handleTransformEnd,
    autoGrow,
  } = context;

  let touchMode = TouchMode.IDLE;
  let pointerOriginX = 0;
  let pointerOriginY = 0;
  let _isPen = false; // per-stroke: is this particular stroke drawn with a pen?
  let segmentMode = 'free'; // 'free' | 'straight'
  let straightSegmentAnchor = null; // Straight line start point.

  const AUTO_GROW_MARGIN = 40; // px from canvas bottom edge
  const AUTO_GROW_STEP = 200;

  function checkAutoGrow() {
    if (typeof autoGrow !== 'function') return;
    const pts = currentPointsRef.value;
    if (!pts || pts.length === 0) return;
    const lastPt = pts[pts.length - 1];
    if (!lastPt) return;
    const y = lastPt[1];
    if (state.height - y < AUTO_GROW_MARGIN) {
      autoGrow(AUTO_GROW_STEP);
    }
  }

  function resetTouchMode() {
    touchMode = TouchMode.IDLE;
    segmentMode = 'free';
    straightSegmentAnchor = null;
  }

  const handlePointerDown = (e) => {
    if (state.isPenMode && !isPen(e)) return;
    if (!isDeliberateInput(e, state.isPenMode)) return;
    if (isPalmTouch(e)) return;

    e.preventDefault();
    e.stopPropagation();

    const svgElem = e.currentTarget;
    if (svgElem.setPointerCapture) svgElem.setPointerCapture(e.pointerId);

    const [x, y] = getPointerCoordinates(e, svgRef.value);

    if (isPen(e) && !state.isPenMode) {
      state.isPenMode = true;
    }
    _isPen = isPen(e);

    if (isStylusEraser(e) && state.tool !== 'eraser') {
      state._preEraserTool = state.tool;
      state.tool = 'eraser';
      touchMode = TouchMode.ERASING;
      state.isDrawing = true;
      captureUndoBeforeErase(state);
      return;
    }

    // Lasso tool
    if (state.tool === 'lasso') {
      if (state.selectedElement && isPointInsideSelectionLocal(x, y)) {
        touchMode = TouchMode.TRANSFORMING;
        handleTransformStart(e, 'move');
        return;
      }
      touchMode = TouchMode.SELECTING;
      handleSelectionStart(e);
      return;
    }

    if (state.selectedElement) state.selectedElement = null;

    const pressure = normalisePressure(e);

    touchMode = TouchMode.POINTING;
    pointerOriginX = x;
    pointerOriginY = y;
    segmentMode = state._shiftHeld ? 'straight' : 'free';
    straightSegmentAnchor = null;

    if (state.tool === 'eraser') {
      touchMode = TouchMode.ERASING;
      state.isDrawing = true;
      captureUndoBeforeErase(state);
      return;
    }

    // Start collecting points
    state.isDrawing = true;
    state.currentStrokePoints = [[x, y, pressure]];
    currentPointsRef.value = [[x, y, pressure]];
  };

  // pointer move

  const handlePointerMove = (e) => {
    if (state.isPenMode && !isPen(e)) return;
    if (!isDeliberateInput(e, state.isPenMode)) return;
    if (isPalmTouch(e)) return;

    const [x, y] = getPointerCoordinates(e, svgRef.value);

    checkAutoGrow();

    switch (touchMode) {
      case TouchMode.TRANSFORMING: {
        handleTransformMove(e);
        return;
      }

      case TouchMode.SELECTING: {
        if (state.transformState) {
          handleTransformMove(e);
        } else if (state.selectionBox !== null || state.lassoPoints) {
          handleSelectionMove(e);
        }
        return;
      }

      case TouchMode.ERASING: {
        if (!state.isDrawing) return;
        const radius = (state.eraserSettings?.size ?? 20) / 2;
        const nextLines = applyEraserPoint(state.lines, x, y, radius);
        if (nextLines !== state.lines) {
          state.lines = nextLines;
        }
        state.currentStrokePoints = [[x, y, 0.5]];
        currentPointsRef.value = [[x, y, 0.5]];
        return;
      }

      case TouchMode.POINTING: {
        const dx = x - pointerOriginX;
        const dy = y - pointerOriginY;
        if (dx * dx + dy * dy < DRAG_THRESHOLD_SQ) return;

        touchMode = TouchMode.DRAWING;
        // Fall through to DRAWING
      }
      case TouchMode.DRAWING: {
        if (!state.isDrawing) return;

        if (state._shiftHeld && segmentMode === 'free') {
          const lastPt =
            currentPointsRef.value[currentPointsRef.value.length - 1];
          if (lastPt) {
            straightSegmentAnchor = { x: lastPt[0], y: lastPt[1] };
            segmentMode = 'straight';
          }
        } else if (!state._shiftHeld && segmentMode === 'straight') {
          segmentMode = 'free';
          straightSegmentAnchor = null;
        }

        const events = getCoalescedEvents(e);

        for (const ce of events) {
          const [cx, cy] = getPointerCoordinates(ce, svgRef.value);
          const cp = normalisePressure(ce);

          if (segmentMode === 'straight' && straightSegmentAnchor) {
            // Replace the last point to keep the straight line live
            const pts = currentPointsRef.value;
            pts[pts.length - 1] = [cx, cy, cp];
          } else {
            currentPointsRef.value.push([cx, cy, cp]);
          }
        }

        // Throttle rendering to animation frames
        if (!animationFrameRef.value) {
          animationFrameRef.value = requestAnimationFrame(() => {
            state.currentStrokePoints = [...currentPointsRef.value];
            animationFrameRef.value = null;
          });
        }
        return;
      }
    }
  };

  const handlePointerUp = (e) => {
    if (state.isPenMode && !isPen(e)) return;
    if (!isDeliberateInput(e, state.isPenMode)) return;
    if (isPalmTouch(e)) return;

    e.preventDefault();

    if (animationFrameRef.value) {
      cancelAnimationFrame(animationFrameRef.value);
      animationFrameRef.value = null;
    }

    switch (touchMode) {
      case TouchMode.TRANSFORMING: {
        handleTransformEnd();
        resetTouchMode();
        return;
      }

      case TouchMode.SELECTING: {
        if (state.transformState) {
          handleTransformEnd();
        } else {
          handleSelectionEnd(e);
        }
        resetTouchMode();
        state.isDrawing = false;
        return;
      }

      case TouchMode.ERASING: {
        // Restore tool if we auto-switched from stylus eraser
        if (state._preEraserTool && state.tool === 'eraser') {
          state.tool = state._preEraserTool;
          state._preEraserTool = null;
        }
        state.isDrawing = false;
        state.currentStrokePoints = [];
        currentPointsRef.value = [];
        resetTouchMode();
        return;
      }

      case TouchMode.POINTING: {
        // Tap without drag: deselect if selecting tool, else ignore.
        state.isDrawing = false;
        state.currentStrokePoints = [];
        currentPointsRef.value = [];
        resetTouchMode();
        return;
      }

      case TouchMode.DRAWING: {
        if (!state.isDrawing || currentPointsRef.value.length < 2) {
          state.isDrawing = false;
          state.currentStrokePoints = [];
          currentPointsRef.value = [];
          resetTouchMode();
          return;
        }

        const settings = getSettings();
        const strokePoints = currentPointsRef.value;

        const newStroke = {
          id: `stroke_${state.nextLineId}`,
          tool: state.tool,
          color: settings.color,
          size: settings.size,
          opacity:
            settings.opacity ?? (state.tool === 'highlighter' ? 0.35 : 1),
          _isPen,
          points: strokePoints,
        };

        Object.assign(state, {
          lines: [...state.lines, newStroke],
          undoStack: [...state.undoStack, state.lines],
          redoStack: [],
          isDrawing: false,
          nextLineId: state.nextLineId + 1,
          currentStrokePoints: [],
        });

        currentPointsRef.value = [];
        resetTouchMode();
        return;
      }
    }
  };

  const handlePointerLeave = (e) => {
    if (state.isDrawing) handlePointerUp(e);
  };

  const handlePointerCancel = () => {
    if (animationFrameRef.value) {
      cancelAnimationFrame(animationFrameRef.value);
      animationFrameRef.value = null;
    }
    state.isDrawing = false;
    state.currentStrokePoints = [];
    currentPointsRef.value = [];
    resetTouchMode();
  };

  function captureUndoBeforeErase(s) {
    s.undoStack = [...s.undoStack, s.lines];
    s.redoStack = [];
  }

  function isPointInsideSelectionLocal(px, py) {
    const el = state.selectedElement;
    if (!el) return false;
    const { bounds } = el;
    return (
      px >= bounds.x &&
      px <= bounds.x + bounds.width &&
      py >= bounds.y &&
      py <= bounds.y + bounds.height
    );
  }

  // Shift key tracking (set externally from keyboard events)

  function setShiftHeld(held) {
    state._shiftHeld = held;
  }

  return {
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    handlePointerLeave,
    handlePointerCancel,
    captureUndoBeforeErase,
    setShiftHeld,
  };
}
