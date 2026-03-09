// usePointerHelper.js
import { getStroke } from 'perfect-freehand';
import {
  isPalmTouch,
  isPenInput,
  getPointerCoordinates,
  interpolatePoints,
  getStrokeOptions,
} from './drawHelper.js';
import { recognizeShape, createShape } from './shapesHelper.js';

const LONG_PRESS_DURATION = 500;
const MOVE_CANCEL_THRESHOLD = 5;

export function usePointerHelper(context) {
  const {
    state,
    svgRef,
    startPos,
    isLongPress,
    longPressTimeout,
    emit,
    currentPointsRef,
    animationFrameRef,
    getSettings,
    handleSelectionStart,
    handleSelectionMove,
    handleSelectionEnd,
    handleTransformMove,
    handleTransformEnd,
  } = context;

  const handlePointerDown = (e) => {
    if (isPalmTouch(e) || !isPenInput(e)) return;

    e.preventDefault();
    e.stopPropagation();

    const svgElem = e.currentTarget;
    svgElem.setPointerCapture(e.pointerId);

    if (state.tool === 'select') {
      handleSelectionStart(e);
      return;
    }

    if (state.selectedElement) {
      state.selectedElement = null;
    }

    const svg = svgRef.value;
    const [x, y] = getPointerCoordinates(e, svg);
    startPos.value = { x, y };
    isLongPress.value = false;

    clearTimeout(longPressTimeout.value);
    longPressTimeout.value = null;

    if (state.tool !== 'eraser') {
      longPressTimeout.value = setTimeout(() => {
        isLongPress.value = true;
        longPressTimeout.value = null;
      }, LONG_PRESS_DURATION);
    }

    state.isDrawing = true;
    state.currentStrokePoints = [[x, y]];
    currentPointsRef.value = [[x, y]];

    if (y > state.height - 50) {
      const newHeight = state.height + 100;
      emit('update-attributes', { height: newHeight });
      state.height = newHeight;
    }
  };

  const handlePointerMove = (e) => {
    if (isPalmTouch(e) || !isPenInput(e)) return;

    if (state.tool === 'select') {
      if (state.transformState) {
        handleTransformMove(e);
      } else if (state.selectionBox) {
        handleSelectionMove(e);
      }
      return;
    }

    if (!state.isDrawing) return;

    const svg = svgRef.value;
    const [x, y] = getPointerCoordinates(e, svg);
    const dx = x - startPos.value.x;
    const dy = y - startPos.value.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist > MOVE_CANCEL_THRESHOLD) {
      clearTimeout(longPressTimeout.value);
      longPressTimeout.value = null;
      isLongPress.value = false;
      startPos.value = { x, y };
    } else if (
      state.tool !== 'eraser' &&
      !longPressTimeout.value &&
      !isLongPress.value
    ) {
      longPressTimeout.value = setTimeout(() => {
        isLongPress.value = true;
        longPressTimeout.value = null;
      }, LONG_PRESS_DURATION);
      startPos.value = { x, y };
    }

    currentPointsRef.value.push([x, y]);

    if (!animationFrameRef.value) {
      animationFrameRef.value = requestAnimationFrame(() => {
        const interpolated = interpolatePoints(currentPointsRef.value, {
          smoothness: 0.7,
        });
        state.currentStrokePoints = interpolated;
        animationFrameRef.value = null;
      });
    }

    if (y > state.height - 50) {
      const newHeight = state.height + 100;
      emit('update-attributes', { height: newHeight });
      state.height = newHeight;
    }
  };

  const handlePointerUp = (e) => {
    if (isPalmTouch(e) || !isPenInput(e)) return;

    e.preventDefault();

    clearTimeout(longPressTimeout.value);
    longPressTimeout.value = null;

    if (animationFrameRef.value) {
      cancelAnimationFrame(animationFrameRef.value);
      animationFrameRef.value = null;
    }

    if (state.tool === 'select') {
      if (state.transformState) {
        handleTransformEnd();
      } else {
        handleSelectionEnd();
      }
      return;
    }

    if (isLongPress.value && state.tool !== 'eraser') {
      const points = currentPointsRef.value;
      isLongPress.value = false;

      if (points.length < 2) {
        Object.assign(state, {
          isDrawing: false,
          currentStrokePoints: [],
        });
        currentPointsRef.value = [];
        return;
      }

      const shape = recognizeShape(points);
      const newShape = createShape(
        shape,
        points,
        state.tool,
        state.nextLineId,
        getSettings
      );

      if (newShape) {
        Object.assign(state, {
          lines: [...state.lines, newShape],
          undoStack: [...state.undoStack, [...state.lines]],
          redoStack: [],
          isDrawing: false,
          nextLineId: state.nextLineId + 1,
          currentStrokePoints: [],
        });
      } else {
        Object.assign(state, {
          isDrawing: false,
          currentStrokePoints: [],
        });
      }

      currentPointsRef.value = [];
      return;
    }

    if (!state.isDrawing || currentPointsRef.value.length < 2) {
      Object.assign(state, {
        isDrawing: false,
        currentStrokePoints: [],
      });
      currentPointsRef.value = [];
      return;
    }

    const settings = getSettings();
    const finalPoints = interpolatePoints(currentPointsRef.value, {
      smoothness: 0.7,
    });

    const newLine = {
      id: `line_${state.nextLineId}`,
      points: finalPoints,
      tool: state.tool,
      color: settings.color,
      size: settings.size,
    };

    if (state.tool === 'eraser') {
      const eraserStroke = getStroke(finalPoints, getStrokeOptions(settings));

      const newLines = state.lines.filter((line) => {
        if (!line.points || line.points.length === 0) return true;

        const lineStroke = getStroke(line.points, getStrokeOptions(line));
        return !lineStroke.some(([lx, ly]) =>
          eraserStroke.some(
            ([ex, ey]) =>
              Math.hypot(lx - ex, ly - ey) < state.eraserSettings.size
          )
        );
      });

      Object.assign(state, {
        lines: newLines,
        undoStack: [...state.undoStack, [...state.lines]],
        redoStack: [],
        isDrawing: false,
        currentStrokePoints: [],
      });
    } else {
      Object.assign(state, {
        lines: [...state.lines, newLine],
        undoStack: [...state.undoStack, [...state.lines]],
        redoStack: [],
        isDrawing: false,
        nextLineId: state.nextLineId + 1,
        currentStrokePoints: [],
      });
    }

    currentPointsRef.value = [];
  };

  const handlePointerLeave = (e) => {
    if (isPalmTouch(e) || !isPenInput(e)) return;
    e.preventDefault();
    handlePointerUp(e);
  };

  const handlePointerCancel = (e) => {
    if (isPalmTouch(e) || !isPenInput(e)) return;
    e.preventDefault();

    clearTimeout(longPressTimeout.value);
    longPressTimeout.value = null;

    Object.assign(state, {
      isDrawing: false,
      currentStrokePoints: [],
    });

    currentPointsRef.value = [];
  };

  return {
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    handlePointerLeave,
    handlePointerCancel,
  };
}
