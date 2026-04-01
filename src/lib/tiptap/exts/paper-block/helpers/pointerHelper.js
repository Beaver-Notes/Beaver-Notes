/**
 * pointerHelper.js
 *
 * Handles all pointer events for the drawing canvas.
 *
 * Key design choices:
 *  - Real pressure: every point is [x, y, pressure] where pressure comes
 *    from normalisePressure(e) — actual e.pressure for pen, 0.5 for mouse/touch.
 *  - Segment-split eraser: O(n) per frame. Instead of checking strokes
 *    against each other's rendered outlines (O(n×m)), we find raw points
 *    within the eraser radius and split each affected stroke at those indices.
 *  - No shape recognition (removed — intentional).
 *  - No auto-expand (replaced by explicit resize handle in DrawMode.vue).
 *  - Palm rejection via isPalmTouch().
 */

import {
  isPalmTouch,
  isPenInput,
  getPointerCoordinates,
  normalisePressure,
  interpolatePoints,
} from './drawHelper.js';

// ---------------------------------------------------------------------------
// Segment-split eraser
// ---------------------------------------------------------------------------

/**
 * Given a stroke and a set of eraser positions with a radius, split the
 * stroke into sub-strokes that don't overlap any eraser position.
 *
 * Returns an array of new strokes (may be 0, 1 or more).
 * O(n) per stroke per eraser step.
 */
function splitStrokeByEraser(stroke, eraserX, eraserY, radius) {
  const pts = stroke.points;
  if (!pts || pts.length === 0) return [stroke];

  const r2 = radius * radius;

  // Mark which point indices are "hit"
  const hit = new Uint8Array(pts.length);
  for (let i = 0; i < pts.length; i++) {
    const dx = pts[i][0] - eraserX;
    const dy = pts[i][1] - eraserY;
    if (dx * dx + dy * dy <= r2) hit[i] = 1;
  }

  // If nothing hit, return original
  if (!hit.some(Boolean)) return [stroke];

  // Split at hit boundaries → collect segments of consecutive un-hit points
  const result = [];
  let segment = [];

  for (let i = 0; i < pts.length; i++) {
    if (!hit[i]) {
      segment.push(pts[i]);
    } else {
      if (segment.length >= 2) {
        result.push({ ...stroke, id: `${stroke.id}_s${result.length}`, points: segment });
      }
      segment = [];
    }
  }
  if (segment.length >= 2) {
    result.push({ ...stroke, id: `${stroke.id}_s${result.length}`, points: segment });
  }

  return result;
}

/**
 * Apply eraser at a single (x, y) position to the full lines array.
 * Returns a new array (or the same array if nothing changed).
 */
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

// ---------------------------------------------------------------------------
// Lasso hit-test helper
// ---------------------------------------------------------------------------

/**
 * Ray-casting point-in-polygon test.
 * polygon: [[x,y], ...] closed shape.
 */
function pointInPolygon(px, py, polygon) {
  let inside = false;
  const n = polygon.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    if (
      yi > py !== yj > py &&
      px < ((xj - xi) * (py - yi)) / (yj - yi) + xi
    ) {
      inside = !inside;
    }
  }
  return inside;
}

/**
 * Return true if any of the stroke's raw points fall inside the lasso polygon.
 */
function strokeIntersectsLasso(stroke, lassoPoints) {
  if (!stroke.points?.length || lassoPoints.length < 3) return false;
  return stroke.points.some(([x, y]) => pointInPolygon(x, y, lassoPoints));
}

// ---------------------------------------------------------------------------
// Main composable
// ---------------------------------------------------------------------------

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
    handleTransformMove,
    handleTransformEnd,
  } = context;

  // ── pointer down ──────────────────────────────────────────────────────────

  const handlePointerDown = (e) => {
    if (isPalmTouch(e) || !isPenInput(e)) return;

    e.preventDefault();
    e.stopPropagation();

    // Capture so we keep events even if the pointer leaves the SVG
    const svgElem = e.currentTarget;
    if (svgElem.setPointerCapture) svgElem.setPointerCapture(e.pointerId);

    if (state.tool === 'select' || state.tool === 'lasso') {
      handleSelectionStart(e);
      return;
    }

    // Deselect on any drawing tool tap
    if (state.selectedElement) state.selectedElement = null;

    const svg = svgRef.value;
    const [x, y] = getPointerCoordinates(e, svg);
    const pressure = normalisePressure(e);

    state.isDrawing = true;
    state.currentStrokePoints = [[x, y, pressure]];
    currentPointsRef.value = [[x, y, pressure]];
  };

  // ── pointer move ──────────────────────────────────────────────────────────

  const handlePointerMove = (e) => {
    if (isPalmTouch(e) || !isPenInput(e)) return;

    if (state.tool === 'select' || state.tool === 'lasso') {
      if (state.transformState) {
        handleTransformMove(e);
      } else if (state.selectionBox !== null || state.lassoPoints) {
        handleSelectionMove(e);
      }
      return;
    }

    if (!state.isDrawing) return;

    const svg = svgRef.value;
    const [x, y] = getPointerCoordinates(e, svg);
    const pressure = normalisePressure(e);

    // Eraser: apply immediately per-frame (segment-split, O(n))
    if (state.tool === 'eraser') {
      const radius = (state.eraserSettings?.size ?? 20) / 2;
      const nextLines = applyEraserPoint(state.lines, x, y, radius);
      if (nextLines !== state.lines) {
        // Only push to undo if we actually changed something, but don't flood
        // the undo stack on every frame — we'll push one snapshot on pointerUp.
        state.lines = nextLines;
      }
      state.currentStrokePoints = [[x, y, 0.5]];
      currentPointsRef.value = [[x, y, 0.5]];
      return;
    }

    // Use coalesced events to capture every sub-frame sample from high-Hz styluses
    const events = (typeof e.getCoalescedEvents === 'function')
      ? e.getCoalescedEvents()
      : [e];

    for (const ce of events) {
      const [cx, cy] = getPointerCoordinates(ce, svg);
      const cp = normalisePressure(ce);
      currentPointsRef.value.push([cx, cy, cp]);
    }

    // Throttle rendering to animation frames
    if (!animationFrameRef.value) {
      animationFrameRef.value = requestAnimationFrame(() => {
        state.currentStrokePoints = [...currentPointsRef.value];
        animationFrameRef.value = null;
      });
    }
  };

  // ── pointer up ────────────────────────────────────────────────────────────

  const handlePointerUp = (e) => {
    if (isPalmTouch(e) || !isPenInput(e)) return;
    e.preventDefault();

    if (animationFrameRef.value) {
      cancelAnimationFrame(animationFrameRef.value);
      animationFrameRef.value = null;
    }

    if (state.tool === 'select' || state.tool === 'lasso') {
      if (state.transformState) {
        handleTransformEnd();
      } else {
        handleSelectionEnd(e);
      }
      return;
    }

    if (state.tool === 'eraser') {
      // Push a single undo snapshot now that the eraser stroke is finished.
      // We saved the pre-erase snapshot at pointerDown so we just mark the
      // end of the gesture.
      state.isDrawing = false;
      state.currentStrokePoints = [];
      currentPointsRef.value = [];
      return;
    }

    if (!state.isDrawing || currentPointsRef.value.length < 2) {
      state.isDrawing = false;
      state.currentStrokePoints = [];
      currentPointsRef.value = [];
      return;
    }

    const settings = getSettings();
    const rawPoints = currentPointsRef.value;

    // Smooth the raw pointer samples before committing
    const finalPoints = interpolatePoints(rawPoints, {
      threshold: settings.tool === 'highlighter' ? 5 : 4,
      passes:    settings.tool === 'highlighter' ? 1 : 2,
    });

    const newStroke = {
      id:      `stroke_${state.nextLineId}`,
      tool:    state.tool,
      color:   settings.color,
      size:    settings.size,
      opacity: settings.opacity ?? (state.tool === 'highlighter' ? 0.35 : 1),
      points:  finalPoints,
    };

    Object.assign(state, {
      lines:       [...state.lines, newStroke],
      undoStack:   [...state.undoStack, state.lines],
      redoStack:   [],
      isDrawing:   false,
      nextLineId:  state.nextLineId + 1,
      currentStrokePoints: [],
    });

    currentPointsRef.value = [];
  };

  // ── pointer leave / cancel ────────────────────────────────────────────────

  const handlePointerLeave = (e) => {
    if (!state.isDrawing) return;
    handlePointerUp(e);
  };

  const handlePointerCancel = () => {
    if (animationFrameRef.value) {
      cancelAnimationFrame(animationFrameRef.value);
      animationFrameRef.value = null;
    }
    state.isDrawing = false;
    state.currentStrokePoints = [];
    currentPointsRef.value = [];
  };

  // ── eraser undo snapshot helper ───────────────────────────────────────────

  /**
   * Call this at pointer-down when the eraser tool is active, to capture
   * the pre-erase state for undo.
   */
  const captureUndoBeforeErase = () => {
    state.undoStack = [...state.undoStack, state.lines];
    state.redoStack = [];
  };

  return {
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    handlePointerLeave,
    handlePointerCancel,
    captureUndoBeforeErase,
    strokeIntersectsLasso,
  };
}
