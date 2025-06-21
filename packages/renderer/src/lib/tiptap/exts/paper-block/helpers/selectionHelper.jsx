// useSelectionHelper.js
import {
  getLineBounds,
  isPalmTouch,
  getPointerCoordinates,
} from './drawHelper.js';

export default function useSelectionHelper(
  state,
  svgRef,
  isPointInsideSelection,
  handleTransformStart
) {
  const handleSelectionStart = (e) => {
    if (state.tool !== 'select' || isPalmTouch(e)) return;
    const svg = svgRef.value;
    const [x, y] = getPointerCoordinates(e, svg);

    if (state.selectedElement && isPointInsideSelection(x, y)) {
      handleTransformStart(e, 'move');
      return;
    }

    Object.assign(state, {
      isDrawing: true,
      selectionBox: { startX: x, startY: y, currentX: x, currentY: y },
      selectedElement: null,
    });
  };

  const handleSelectionMove = (e) => {
    if (!state.selectionBox || state.tool !== 'select' || isPalmTouch(e))
      return;
    const svg = svgRef.value;
    const [x, y] = getPointerCoordinates(e, svg);

    Object.assign(state.selectionBox, { currentX: x, currentY: y });
  };

  const handleSelectionEnd = () => {
    if (!state.selectionBox || state.tool !== 'select') return;

    const bounds = {
      x: Math.min(state.selectionBox.startX, state.selectionBox.currentX),
      y: Math.min(state.selectionBox.startY, state.selectionBox.currentY),
      width: Math.abs(state.selectionBox.currentX - state.selectionBox.startX),
      height: Math.abs(state.selectionBox.currentY - state.selectionBox.startY),
    };

    if (bounds.width > 5 && bounds.height > 5) {
      const selectedLines = state.lines.filter((line) => {
        const lineBounds = getLineBounds(line);
        return (
          lineBounds.x < bounds.x + bounds.width &&
          lineBounds.x + lineBounds.width > bounds.x &&
          lineBounds.y < bounds.y + bounds.height &&
          lineBounds.y + lineBounds.height > bounds.y
        );
      });

      if (selectedLines.length > 0) {
        const actualBounds = selectedLines.reduce(
          (acc, line) => {
            const lineBounds = getLineBounds(line);
            return {
              x: Math.min(acc.x, lineBounds.x),
              y: Math.min(acc.y, lineBounds.y),
              maxX: Math.max(acc.maxX, lineBounds.x + lineBounds.width),
              maxY: Math.max(acc.maxY, lineBounds.y + lineBounds.height),
            };
          },
          { x: Infinity, y: Infinity, maxX: -Infinity, maxY: -Infinity }
        );

        const finalBounds = {
          x: actualBounds.x,
          y: actualBounds.y,
          width: actualBounds.maxX - actualBounds.x,
          height: actualBounds.maxY - actualBounds.y,
        };

        Object.assign(state, {
          selectedElement: {
            type: 'group',
            lines: selectedLines,
            bounds: finalBounds,
            lineIds: selectedLines.map((line) => line.id),
          },
          selectionBox: null,
          isDrawing: false,
        });
        return;
      }
    }

    Object.assign(state, { selectionBox: null, isDrawing: false });
  };

  return {
    handleSelectionStart,
    handleSelectionMove,
    handleSelectionEnd,
  };
}
