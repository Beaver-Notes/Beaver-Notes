import { computed, reactive, ref, shallowRef } from 'vue';
import { getStroke } from 'perfect-freehand';
import {
  getStrokeOptions,
  getSvgPathFromStroke,
  getPointerCoordinates,
  isPalmTouch,
  isPenInput,
  interpolatePoints,
} from '@/lib/tiptap/exts/paper-block/helpers/drawHelper';

let _instance = null;

function cloneStrokes(strokeList = []) {
  return strokeList.map((stroke) => ({
    ...stroke,
    points: Array.isArray(stroke.points)
      ? stroke.points.map((point) => [...point])
      : [],
  }));
}

function pointToSegmentDistance(point, start, end) {
  const [px, py] = point;
  const [x1, y1] = start;
  const [x2, y2] = end;
  const dx = x2 - x1;
  const dy = y2 - y1;

  if (dx === 0 && dy === 0) {
    return Math.hypot(px - x1, py - y1);
  }

  const t = Math.max(
    0,
    Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy))
  );
  const projX = x1 + t * dx;
  const projY = y1 + t * dy;

  return Math.hypot(px - projX, py - projY);
}

function strokeIntersectsEraser(
  strokePoints = [],
  eraserPoints = [],
  radius = 0
) {
  if (strokePoints.length === 0 || eraserPoints.length === 0) return false;

  for (const eraserPoint of eraserPoints) {
    for (let i = 0; i < strokePoints.length; i += 1) {
      const currentPoint = strokePoints[i];
      if (
        Math.hypot(
          currentPoint[0] - eraserPoint[0],
          currentPoint[1] - eraserPoint[1]
        ) <= radius
      ) {
        return true;
      }

      const nextPoint = strokePoints[i + 1];
      if (
        nextPoint &&
        pointToSegmentDistance(eraserPoint, currentPoint, nextPoint) <= radius
      ) {
        return true;
      }
    }
  }

  return false;
}

export function useOverlayDrawing() {
  if (_instance) return _instance;

  const mode = ref('typing');
  const activeTool = ref('pen');
  const toolSettings = reactive({
    pen: { color: '#1a1a1a', size: 2.5 },
    highlighter: { color: '#fbbf24', size: 14 },
    eraser: { size: 18 },
  });
  const strokes = ref([]);
  const currentPoints = ref([]);
  const isDrawing = ref(false);
  const undoStack = ref([]);
  const redoStack = ref([]);
  const editorRef = shallowRef(null);

  const activeSettings = computed(() => toolSettings[activeTool.value]);
  const currentPathData = computed(() => {
    if (currentPoints.value.length < 2 || activeTool.value === 'eraser')
      return '';

    const stroke = getStroke(
      currentPoints.value,
      getStrokeOptions({
        ...activeSettings.value,
        tool: activeTool.value,
      })
    );

    return getSvgPathFromStroke(stroke);
  });

  function pushUndoSnapshot() {
    undoStack.value.push(cloneStrokes(strokes.value));
  }

  function resetLocalState() {
    mode.value = 'typing';
    activeTool.value = 'pen';
    strokes.value = [];
    currentPoints.value = [];
    isDrawing.value = false;
    undoStack.value = [];
    redoStack.value = [];
  }

  function _persistToEditor() {
    if (!editorRef.value) return;

    try {
      editorRef.value.commands.setOverlayStrokes(strokes.value);
    } catch (error) {
      console.error('Failed to persist overlay strokes:', error);
    }
  }

  function _commitStroke(points) {
    pushUndoSnapshot();
    redoStack.value = [];
    strokes.value = [
      ...strokes.value,
      {
        id: `overlay-stroke-${Date.now()}-${Math.random()
          .toString(36)
          .slice(2, 8)}`,
        tool: activeTool.value,
        color: activeSettings.value.color,
        size: activeSettings.value.size,
        points,
      },
    ];
    _persistToEditor();
  }

  function _applyEraser(eraserPoints) {
    const radius = (toolSettings.eraser.size / 2) * 1.5;
    const nextStrokes = strokes.value.filter(
      (stroke) => !strokeIntersectsEraser(stroke.points, eraserPoints, radius)
    );

    if (nextStrokes.length === strokes.value.length) return;

    pushUndoSnapshot();
    redoStack.value = [];
    strokes.value = nextStrokes;
    _persistToEditor();
  }

  function _finishStroke() {
    const points = currentPoints.value;
    currentPoints.value = [];

    if (points.length < 2) return;

    const interpolatedPoints = interpolatePoints(points);

    if (activeTool.value === 'eraser') {
      _applyEraser(interpolatedPoints);
      return;
    }

    _commitStroke(interpolatedPoints);
  }

  function toggleMode() {
    if (mode.value === 'drawing') {
      exitDrawMode();
      return;
    }

    enterDrawMode();
  }

  function enterDrawMode() {
    mode.value = 'drawing';
  }

  function exitDrawMode() {
    _finishStroke();
    isDrawing.value = false;
    mode.value = 'typing';
  }

  function setTool(tool) {
    activeTool.value = tool;
  }

  function setColor(color) {
    if (activeTool.value === 'eraser') return;
    toolSettings[activeTool.value].color = color;
  }

  function setSize(size) {
    toolSettings[activeTool.value].size = Number(size);
  }

  function beginStroke(svgEl, event) {
    if (isPalmTouch(event) || !isPenInput(event)) return;

    event.preventDefault();
    event.stopPropagation();

    const coords = getPointerCoordinates(event, svgEl);
    currentPoints.value = [coords];
    isDrawing.value = true;
  }

  function continueStroke(svgEl, event) {
    if (!isDrawing.value || isPalmTouch(event) || !isPenInput(event)) return;

    event.preventDefault();
    event.stopPropagation();

    currentPoints.value = [
      ...currentPoints.value,
      getPointerCoordinates(event, svgEl),
    ];
  }

  function endStroke() {
    if (!isDrawing.value) return;
    isDrawing.value = false;
    _finishStroke();
  }

  function cancelStroke() {
    isDrawing.value = false;
    currentPoints.value = [];
  }

  function undo() {
    if (undoStack.value.length === 0) return;

    redoStack.value.push(cloneStrokes(strokes.value));
    strokes.value = undoStack.value.pop() || [];
    _persistToEditor();
  }

  function redo() {
    if (redoStack.value.length === 0) return;

    undoStack.value.push(cloneStrokes(strokes.value));
    strokes.value = redoStack.value.pop() || [];
    _persistToEditor();
  }

  function clearAll() {
    if (strokes.value.length === 0) return;

    pushUndoSnapshot();
    redoStack.value = [];
    strokes.value = [];
    _persistToEditor();
  }

  function syncFromEditor(editor) {
    editorRef.value = editor || null;

    if (!editor) {
      resetLocalState();
      return;
    }

    const nextStrokes = [];

    editor.state.doc.descendants((node) => {
      if (node.type.name === 'overlayDrawing') {
        nextStrokes.push(
          ...(Array.isArray(node.attrs.strokes) ? node.attrs.strokes : [])
        );
        return false;
      }

      return true;
    });

    strokes.value = cloneStrokes(nextStrokes);
    currentPoints.value = [];
    isDrawing.value = false;
    undoStack.value = [];
    redoStack.value = [];
  }

  function getPathForStroke(stroke) {
    if (!Array.isArray(stroke?.points) || stroke.points.length < 2) return '';

    return getSvgPathFromStroke(
      getStroke(stroke.points, getStrokeOptions(stroke))
    );
  }

  function handleKeyDown(e) {
    if (mode.value !== 'drawing') return;

    if (e.key === 'Escape') {
      e.preventDefault();
      exitDrawMode();
      return;
    }

    const isMod = e.metaKey || e.ctrlKey;
    if (!isMod || e.key.toLowerCase() !== 'z') return;

    e.preventDefault();
    if (e.shiftKey) {
      redo();
      return;
    }

    undo();
  }

  _instance = {
    mode,
    activeTool,
    toolSettings,
    strokes,
    currentPoints,
    isDrawing,
    undoStack,
    redoStack,
    editorRef,
    activeSettings,
    currentPathData,
    toggleMode,
    enterDrawMode,
    exitDrawMode,
    setTool,
    setColor,
    setSize,
    beginStroke,
    continueStroke,
    endStroke,
    cancelStroke,
    syncFromEditor,
    getPathForStroke,
    handleKeyDown,
    clearAll,
    undo,
    redo,
  };

  return _instance;
}
