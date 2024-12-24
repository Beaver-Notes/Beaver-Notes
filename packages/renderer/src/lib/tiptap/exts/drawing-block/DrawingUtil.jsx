import { ref, computed } from 'vue';
import * as d3 from 'd3';
import { v4 as uuid } from 'uuid';

const isDarkMode = document.documentElement.classList.contains('dark');

export const thicknessOptions = {
  thin: 2,
  medium: 3,
  thick: 4,
  thicker: 5,
  thickest: 6,
};

export const backgroundStyles = {
  none: '',
  grid: 'grid',
  ruled: 'ruled',
  dotted: 'dotted',
};

// Smooth Points: Applies smoothing to the given points to make the path more natural.
export function useSmoothPoints() {
  const smoothPoints = (points) => {
    if (!Array.isArray(points) || points.length < 3) return points;
    return points.map((point, i, arr) => {
      if (i === 0 || i === arr.length - 1) return point;
      const prev = arr[i - 1];
      const next = arr[i + 1];
      return {
        x: (prev.x + point.x + next.x) / 3,
        y: (prev.y + point.y + next.y) / 3,
      };
    });
  };
  return { smoothPoints };
}

// Chunked Lines: Breaks lines into smaller chunks for better rendering performance.
export function useChunkedLines(linesRef) {
  const chunkedLines = computed(() => {
    if (!Array.isArray(linesRef.value)) return [];
    const chunkSize = 100;
    const chunks = [];
    for (let i = 0; i < linesRef.value.length; i += chunkSize) {
      chunks.push(linesRef.value.slice(i, i + chunkSize));
    }
    return chunks;
  });
  return { chunkedLines };
}

// Erase Overlapping Paths: Erases paths that overlap with a given area.
export function useEraseOverlappingPaths(
  svgRef,
  linesRef,
  setHistory,
  updateAttributes
) {
  const eraseRadius = 5;

  const eraseOverlappingPaths = (x, y) => {
    const svg = d3.select(svgRef.value);
    const eraserArea = {
      x: x - eraseRadius,
      y: y - eraseRadius,
      width: eraseRadius * 2,
      height: eraseRadius * 2,
    };

    svg.selectAll('path').each(function () {
      const path = d3.select(this);
      const pathNode = path.node();
      const pathBBox = pathNode.getBBox();

      if (
        pathBBox.x < eraserArea.x + eraserArea.width &&
        pathBBox.x + pathBBox.width > eraserArea.x &&
        pathBBox.y < eraserArea.y + eraserArea.height &&
        pathBBox.y + pathBBox.height > eraserArea.y
      ) {
        deletePath(pathNode);
      }
    });
  };

  const deletePath = (pathElement) => {
    const clickedPathData = pathElement.getAttribute('d');
    const pathIndex = linesRef.value.findIndex(
      (line) => line.path === clickedPathData
    );

    if (pathIndex !== -1) {
      const removedLine = linesRef.value[pathIndex];
      setHistory((prevHistory) =>
        Array.isArray(prevHistory)
          ? [...prevHistory, { action: 'delete', line: removedLine }]
          : []
      );
      linesRef.value.splice(pathIndex, 1);
      updateAttributes({ lines: linesRef.value });
    }
  };

  return { eraseOverlappingPaths };
}

// Get Pointer Coordinates: Translates mouse or touch events to SVG coordinates.
export function useGetPointerCoordinates(svgRef) {
  const getPointerCoordinates = (event) => {
    const svg = svgRef.value;
    const rect = svg.getBoundingClientRect();
    const clientX = event.touches ? event.touches[0].clientX : event.clientX;
    const clientY = event.touches ? event.touches[0].clientY : event.clientY;
    const scaleX = svg.viewBox.baseVal.width / rect.width;
    const scaleY = svg.viewBox.baseVal.height / rect.height;
    return [(clientX - rect.left) * scaleX, (clientY - rect.top) * scaleY];
  };
  return { getPointerCoordinates };
}

// Save Drawing: Saves the current drawing state and updates history.
export function useSaveDrawing(
  linesRef,
  setHistory,
  updateAttributes,
  path,
  color,
  size,
  tool,
  setRedoStack
) {
  const batchUpdateTimeoutRef = ref(null);

  const saveDrawing = () => {
    if (!path.value) return;
    const newLine = {
      id: uuid(),
      path: path.value,
      color: color.value,
      size: size.value,
      tool: tool.value,
    };
    linesRef.value = Array.isArray(linesRef.value)
      ? [...linesRef.value, newLine]
      : [newLine];
    setHistory((prevHistory) =>
      Array.isArray(prevHistory)
        ? [...prevHistory, { action: 'add', line: newLine }]
        : []
    );
    setRedoStack([]);
    batchUpdatePaths();
  };

  const batchUpdatePaths = () => {
    if (batchUpdateTimeoutRef.value) clearTimeout(batchUpdateTimeoutRef.value);
    batchUpdateTimeoutRef.value = setTimeout(() => {
      updateAttributes({ lines: linesRef.value });
    }, 500);
  };

  return { saveDrawing };
}

// Render Paths: Dynamically renders paths with chunked data.
export function useRenderPaths(chunkedLines) {
  const adjustColorForMode = (color) =>
    isDarkMode && color === '#000000'
      ? '#FFFFFF'
      : color === '#FFFFFF'
      ? '#000000'
      : color;

  const renderPaths = () =>
    chunkedLines.value.map((chunk, chunkIndex) => (
      <g key={`chunk-${chunkIndex}`}>
        {chunk.map((item) => (
          <path
            key={`${item.id}-${item.color}-${item.size}`}
            d={item.path}
            stroke={adjustColorForMode(item.color)}
            strokeWidth={item.size}
            opacity={item.tool === 'highlighter' ? 0.3 : 1}
            fill="none"
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </g>
    ));

  return { renderPaths };
}

// Line Generator: Generates a smooth SVG path.
export function useLineGenerator() {
  const lineGenerator = computed(() =>
    d3
      .line()
      .x((d) => d.x)
      .y((d) => d.y)
      .curve(d3.curveBasis)
  );
  return { lineGenerator };
}

// Undo: Reverts the last action.
export function useUndo(history, redoStack, updateAttributes, linesRef) {
  const undo = () => {
    if (!Array.isArray(history.value) || history.value.length === 0) return;
    const lastAction = history.value.pop();
    redoStack.value = Array.isArray(redoStack.value)
      ? [...redoStack.value, lastAction]
      : [lastAction];
    if (lastAction.action === 'add') {
      linesRef.value = linesRef.value.filter(
        (line) => line.id !== lastAction.line.id
      );
    } else if (lastAction.action === 'delete') {
      linesRef.value = [...linesRef.value, lastAction.line];
    }
    updateAttributes({ lines: linesRef.value });
  };
  return { undo };
}

// Redo: Reapplies the last undone action.
export function useRedo(redoStack, history, updateAttributes, linesRef) {
  const redo = () => {
    if (!Array.isArray(redoStack.value) || redoStack.value.length === 0) return;
    const lastRedo = redoStack.value.pop();
    history.value = Array.isArray(history.value)
      ? [...history.value, lastRedo]
      : [lastRedo];
    if (lastRedo.action === 'add') {
      linesRef.value = [...linesRef.value, lastRedo.line];
    } else if (lastRedo.action === 'delete') {
      linesRef.value = linesRef.value.filter(
        (line) => line.id !== lastRedo.line.id
      );
    }
    updateAttributes({ lines: linesRef.value });
  };
  return { redo };
}
