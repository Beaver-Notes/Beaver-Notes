import {
  isPalmTouch,
  getPointerCoordinates,
  transformPoints,
} from './drawHelper';
const TRANSFORM_MOVE_THRESHOLD = 2;

export default function useTransforHelper(state, svgRef) {
  const handleTransformStart = (e, corner) => {
    if (!state.selectedElement || isPalmTouch(e)) return;
    e.stopPropagation();

    const svg = svgRef.value;
    const [x, y] = getPointerCoordinates(e, svg);

    Object.assign(state, {
      transformState: {
        corner,
        startX: x,
        startY: y,
        originalBounds: { ...state.selectedElement.bounds },
        originalLines: [...state.selectedElement.lines],
        lineIds: [...state.selectedElement.lineIds],
      },
      isDrawing: true,
    });
  };

  const handleTransformMove = (e) => {
    if (!state.transformState || !state.selectedElement || isPalmTouch(e))
      return;

    const svg = svgRef.value;
    const [currentX, currentY] = getPointerCoordinates(e, svg);
    const dx = currentX - state.transformState.startX;
    const dy = currentY - state.transformState.startY;

    if (
      Math.abs(dx) < TRANSFORM_MOVE_THRESHOLD &&
      Math.abs(dy) < TRANSFORM_MOVE_THRESHOLD
    ) {
      return;
    }

    let newBounds = { ...state.selectedElement.bounds };

    if (state.transformState.corner === 'move') {
      newBounds.x = state.transformState.originalBounds.x + dx;
      newBounds.y = state.transformState.originalBounds.y + dy;
    } else {
      const minSize = 10;

      if (state.transformState.corner.includes('n')) {
        const newHeight = state.transformState.originalBounds.height - dy;
        if (newHeight > minSize) {
          newBounds.y = state.transformState.originalBounds.y + dy;
          newBounds.height = newHeight;
        }
      }
      if (state.transformState.corner.includes('s')) {
        const newHeight = state.transformState.originalBounds.height + dy;
        if (newHeight > minSize) {
          newBounds.height = newHeight;
        }
      }
      if (state.transformState.corner.includes('w')) {
        const newWidth = state.transformState.originalBounds.width - dx;
        if (newWidth > minSize) {
          newBounds.x = state.transformState.originalBounds.x + dx;
          newBounds.width = newWidth;
        }
      }
      if (state.transformState.corner.includes('e')) {
        const newWidth = state.transformState.originalBounds.width + dx;
        if (newWidth > minSize) {
          newBounds.width = newWidth;
        }
      }
    }

    state.selectedElement = {
      ...state.selectedElement,
      bounds: newBounds,
    };
  };

  const handleTransformEnd = () => {
    if (!state.transformState || !state.selectedElement) return;

    const transformType =
      state.transformState.corner === 'move' ? 'move' : 'resize';

    const transformedLines = state.lines.map((line) => {
      if (state.transformState.lineIds.includes(line.id)) {
        const transformedPoints = transformPoints(
          line.points,
          state.transformState.originalBounds,
          state.selectedElement.bounds,
          transformType
        );

        return { ...line, points: transformedPoints };
      }
      return line;
    });

    const transformedSelectedLines = transformedLines.filter((line) =>
      state.transformState.lineIds.includes(line.id)
    );

    Object.assign(state, {
      lines: transformedLines,
      undoStack: [...state.undoStack, state.lines],
      isDrawing: false,
      selectedElement: {
        type: 'group',
        lines: transformedSelectedLines,
        bounds: state.selectedElement.bounds,
        lineIds: state.transformState.lineIds,
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
