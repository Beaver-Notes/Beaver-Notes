/**
 * selectionHelper.js
 *
 * Handles both rectangular-box selection (tool === 'select') and
 * freehand lasso selection (tool === 'lasso').
 *
 * Selected element shape:
 *   {
 *     type:    'group',
 *     lines:   Stroke[],       // the selected stroke objects (snapshot)
 *     lineIds: string[],       // ids for quick lookup
 *     bounds:  { x, y, width, height },
 *     rotation: number,        // degrees, 0 by default
 *   }
 */

import {
  getLineBounds,
  isPalmTouch,
  getPointerCoordinates,
} from './drawHelper.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function computeGroupBounds(lines) {
  if (lines.length === 0) return { x: 0, y: 0, width: 0, height: 0 };

  const result = lines.reduce(
    (acc, line) => {
      const b = getLineBounds(line);
      return {
        x:    Math.min(acc.x,    b.x),
        y:    Math.min(acc.y,    b.y),
        maxX: Math.max(acc.maxX, b.x + b.width),
        maxY: Math.max(acc.maxY, b.y + b.height),
      };
    },
    { x: Infinity, y: Infinity, maxX: -Infinity, maxY: -Infinity }
  );

  return {
    x:      result.x,
    y:      result.y,
    width:  result.maxX - result.x,
    height: result.maxY - result.y,
  };
}

/** Ray-casting point-in-polygon. polygon: [[x,y], ...] */
function pointInPolygon(px, py, polygon) {
  let inside = false;
  const n = polygon.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    if (
      yi > py !== yj > py &&
      px < ((xj - xi) * (py - yi)) / (yj - yi) + xi
    ) inside = !inside;
  }
  return inside;
}

function strokeIntersectsLasso(stroke, lassoPoints) {
  if (!stroke.points?.length || lassoPoints.length < 3) return false;
  return stroke.points.some(([x, y]) => pointInPolygon(x, y, lassoPoints));
}

function strokeIntersectsRect(stroke, bounds) {
  const b = getLineBounds(stroke);
  return (
    b.x < bounds.x + bounds.width  &&
    b.x + b.width  > bounds.x       &&
    b.y < bounds.y + bounds.height &&
    b.y + b.height > bounds.y
  );
}

// ---------------------------------------------------------------------------
// Composable
// ---------------------------------------------------------------------------

export default function useSelectionHelper(
  state,
  svgRef,
  isPointInsideSelection,
  handleTransformStart
) {
  // ── start ──────────────────────────────────────────────────────────────────

  const handleSelectionStart = (e) => {
    if (isPalmTouch(e)) return;
    const [x, y] = getPointerCoordinates(e, svgRef.value);

    // If there's a live selection and the pointer is inside it → move
    if (state.selectedElement && isPointInsideSelection(x, y)) {
      handleTransformStart(e, 'move');
      return;
    }

    // Start a new selection gesture
    state.selectedElement = null;
    state.isDrawing = true;

    if (state.tool === 'lasso') {
      // Lasso: accumulate freehand polygon
      state.lassoPoints = [[x, y]];
      state.selectionBox = null;
    } else {
      // Rect select
      state.selectionBox = { startX: x, startY: y, currentX: x, currentY: y };
      state.lassoPoints = null;
    }
  };

  // ── move ───────────────────────────────────────────────────────────────────

  const handleSelectionMove = (e) => {
    if (isPalmTouch(e) || !state.isDrawing) return;
    const [x, y] = getPointerCoordinates(e, svgRef.value);

    if (state.tool === 'lasso' && state.lassoPoints) {
      state.lassoPoints = [...state.lassoPoints, [x, y]];
    } else if (state.selectionBox) {
      state.selectionBox = { ...state.selectionBox, currentX: x, currentY: y };
    }
  };

  // ── end ────────────────────────────────────────────────────────────────────

  const handleSelectionEnd = () => {
    if (!state.isDrawing) return;
    state.isDrawing = false;

    let selectedLines = [];

    if (state.tool === 'lasso' && state.lassoPoints?.length >= 3) {
      selectedLines = state.lines.filter((line) =>
        strokeIntersectsLasso(line, state.lassoPoints)
      );
      state.lassoPoints = null;

    } else if (state.selectionBox) {
      const sb = state.selectionBox;
      const bounds = {
        x:      Math.min(sb.startX, sb.currentX),
        y:      Math.min(sb.startY, sb.currentY),
        width:  Math.abs(sb.currentX - sb.startX),
        height: Math.abs(sb.currentY - sb.startY),
      };
      state.selectionBox = null;

      if (bounds.width < 5 || bounds.height < 5) {
        // Click with no drag → deselect
        return;
      }

      selectedLines = state.lines.filter((line) =>
        strokeIntersectsRect(line, bounds)
      );
    }

    if (selectedLines.length > 0) {
      state.selectedElement = {
        type:     'group',
        lines:    selectedLines,
        lineIds:  selectedLines.map((l) => l.id),
        bounds:   computeGroupBounds(selectedLines),
        rotation: 0,
      };
    }
  };

  return {
    handleSelectionStart,
    handleSelectionMove,
    handleSelectionEnd,
  };
}
