/**
 * transformHelper.js
 *
 * Handles move, resize, and rotation transforms on a selection group.
 *
 * Transform state shape:
 *   {
 *     corner:         'move' | 'nw'|'ne'|'sw'|'se'|'rotate',
 *     startX/startY:  pointer position at drag start (SVG coords),
 *     startAngle:     angle from selection centre to pointer at rotate start,
 *     originalBounds: bounding box snapshot,
 *     originalLines:  stroke snapshot (original points),
 *     lineIds:        string[],
 *   }
 */

import {
  isPalmTouch,
  getPointerCoordinates,
  transformPoints,
  rotatePoints,
} from './drawHelper.js';

const MOVE_THRESHOLD = 2; // px dead-zone before transform activates

export default function useTransformHelper(state, svgRef) {

  // ── start ──────────────────────────────────────────────────────────────────

  const handleTransformStart = (e, corner) => {
    if (!state.selectedElement || isPalmTouch(e)) return;
    e.stopPropagation();

    const [x, y] = getPointerCoordinates(e, svgRef.value);
    const { bounds } = state.selectedElement;
    const cx = bounds.x + bounds.width  / 2;
    const cy = bounds.y + bounds.height / 2;

    state.transformState = {
      corner,
      startX:         x,
      startY:         y,
      startAngle:     corner === 'rotate' ? Math.atan2(y - cy, x - cx) : 0,
      originalBounds: { ...bounds },
      originalLines:  state.selectedElement.lines.map((l) => ({
        ...l,
        points: l.points.map((p) => [...p]),
      })),
      lineIds: [...state.selectedElement.lineIds],
    };

    state.isDrawing = true;
  };

  // ── move ───────────────────────────────────────────────────────────────────

  const handleTransformMove = (e) => {
    if (!state.transformState || !state.selectedElement || isPalmTouch(e)) return;

    const [currentX, currentY] = getPointerCoordinates(e, svgRef.value);
    const dx = currentX - state.transformState.startX;
    const dy = currentY - state.transformState.startY;

    if (
      Math.abs(dx) < MOVE_THRESHOLD &&
      Math.abs(dy) < MOVE_THRESHOLD &&
      state.transformState.corner !== 'rotate'
    ) return;

    const { corner, originalBounds } = state.transformState;

    // ── rotation ─────────────────────────────────────────────────────────────
    if (corner === 'rotate') {
      const { bounds } = state.selectedElement;
      const cx = originalBounds.x + originalBounds.width  / 2;
      const cy = originalBounds.y + originalBounds.height / 2;

      const currentAngle = Math.atan2(currentY - cy, currentX - cx);
      const deltaAngle = (currentAngle - state.transformState.startAngle) * (180 / Math.PI);
      const totalRotation = (state.selectedElement.rotation ?? 0) + deltaAngle;

      state.selectedElement = {
        ...state.selectedElement,
        rotation: totalRotation,
      };

      state.transformState = {
        ...state.transformState,
        startAngle: currentAngle,
      };

      return;
    }

    // ── move ──────────────────────────────────────────────────────────────────
    if (corner === 'move') {
      const newBounds = {
        ...originalBounds,
        x: originalBounds.x + dx,
        y: originalBounds.y + dy,
      };
      state.selectedElement = { ...state.selectedElement, bounds: newBounds };
      return;
    }

    // ── resize ────────────────────────────────────────────────────────────────
    const minSize = 10;
    let { x, y: by, width, height } = { ...originalBounds };

    if (corner.includes('n')) {
      const newH = originalBounds.height - dy;
      if (newH > minSize) { by = originalBounds.y + dy; height = newH; }
    }
    if (corner.includes('s')) {
      const newH = originalBounds.height + dy;
      if (newH > minSize) height = newH;
    }
    if (corner.includes('w')) {
      const newW = originalBounds.width - dx;
      if (newW > minSize) { x = originalBounds.x + dx; width = newW; }
    }
    if (corner.includes('e')) {
      const newW = originalBounds.width + dx;
      if (newW > minSize) width = newW;
    }

    state.selectedElement = {
      ...state.selectedElement,
      bounds: { x, y: by, width, height },
    };
  };

  // ── end ────────────────────────────────────────────────────────────────────

  const handleTransformEnd = () => {
    if (!state.transformState || !state.selectedElement) return;

    const { corner, originalBounds, originalLines, lineIds } = state.transformState;
    const { bounds: newBounds, rotation } = state.selectedElement;

    const prevLines = state.lines; // for undo

    let updatedLines;

    if (corner === 'rotate' && rotation !== 0) {
      const cx = originalBounds.x + originalBounds.width  / 2;
      const cy = originalBounds.y + originalBounds.height / 2;

      updatedLines = state.lines.map((line) => {
        if (!lineIds.includes(line.id)) return line;
        return { ...line, points: rotatePoints(line.points, cx, cy, rotation) };
      });

    } else if (corner === 'move' || corner.match(/[nsew]/)) {
      const type = corner === 'move' ? 'move' : 'resize';

      updatedLines = state.lines.map((line) => {
        if (!lineIds.includes(line.id)) return line;
        const orig = originalLines.find((l) => l.id === line.id) ?? line;
        return {
          ...line,
          points: transformPoints(orig.points, originalBounds, newBounds, type),
        };
      });

    } else {
      // No meaningful change (e.g. sub-threshold drag)
      state.transformState = null;
      state.isDrawing = false;
      return;
    }

    // Recompute final bounding box from moved/rotated points
    const transformedSelectedLines = updatedLines.filter((l) =>
      lineIds.includes(l.id)
    );

    const finalBounds = transformedSelectedLines.reduce(
      (acc, line) => {
        const b = _lineBounds(line);
        return {
          x:    Math.min(acc.x,    b.x),
          y:    Math.min(acc.y,    b.y),
          maxX: Math.max(acc.maxX, b.x + b.width),
          maxY: Math.max(acc.maxY, b.y + b.height),
        };
      },
      { x: Infinity, y: Infinity, maxX: -Infinity, maxY: -Infinity }
    );

    Object.assign(state, {
      lines:    updatedLines,
      undoStack: [...state.undoStack, prevLines],
      redoStack: [],
      isDrawing: false,
      selectedElement: {
        type:     'group',
        lines:    transformedSelectedLines,
        lineIds:  lineIds,
        bounds:   { x: finalBounds.x, y: finalBounds.y, width: finalBounds.maxX - finalBounds.x, height: finalBounds.maxY - finalBounds.y },
        rotation: 0,
      },
      transformState: null,
    });
  };

  return {
    handleTransformStart,
    handleTransformMove,
    handleTransformEnd,
  };
}

// Internal bounds helper (avoids circular import with drawHelper)
function _lineBounds(stroke) {
  const pts = stroke?.points;
  if (!pts?.length) return { x: 0, y: 0, width: 0, height: 0 };
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of pts) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}
