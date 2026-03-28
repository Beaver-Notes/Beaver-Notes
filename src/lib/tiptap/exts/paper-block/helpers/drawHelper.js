// drawHelper.js (Vue version)
import * as d3 from 'd3';
import { getStroke } from 'perfect-freehand';

export const HIGHLIGHTER_OPACITY = 0.36;

export const DRAW_TOOL_DEFAULTS = Object.freeze({
  pen: Object.freeze({ color: '#1a1a1a', size: 2.2 }),
  highlighter: Object.freeze({ color: '#fbbf24', size: 12 }),
  eraser: Object.freeze({ size: 16 }),
});

export function cloneDrawingToolDefaults() {
  return {
    pen: { ...DRAW_TOOL_DEFAULTS.pen },
    highlighter: { ...DRAW_TOOL_DEFAULTS.highlighter },
    eraser: { ...DRAW_TOOL_DEFAULTS.eraser },
  };
}

/**
 * Calculates the average of two numbers.
 * @param {number} a
 * @param {number} b
 * @returns {number} Average of a and b.
 */
export const average = (a, b) => (a + b) / 2;

/**
 * Generates an SVG path string from an array of points using cubic Bezier curves.
 * Uses a Catmull-Rom spline approximation.
 *
 * @param {Array<[number, number]>} points - Array of [x, y] points.
 * @returns {string} SVG path string.
 */
export function getSvgPathFromStroke(points) {
  if (!points.length) return '';

  const first = points[0];
  const second = points[1];

  if (!second) {
    return `M ${first[0]} ${first[1]} Z`;
  }

  let path = `M ${average(first[0], second[0])} ${average(
    first[1],
    second[1]
  )}`;

  for (let i = 1; i < points.length; i += 1) {
    const current = points[i];
    const next = points[(i + 1) % points.length];
    path += ` Q ${current[0]} ${current[1]} ${average(
      current[0],
      next[0]
    )} ${average(current[1], next[1])}`;
  }

  return `${path} Z`;
}

export function getSmoothLinePath(points) {
  if (!Array.isArray(points) || points.length < 2) return '';

  if (points.length === 2) {
    return `M ${points[0][0]} ${points[0][1]} L ${points[1][0]} ${points[1][1]}`;
  }

  const lineGenerator = d3
    .line()
    .x((point) => point[0])
    .y((point) => point[1])
    .curve(d3.curveCatmullRom.alpha(0.5));

  return lineGenerator(points) || '';
}

/**
 * Converts a pointer/mouse event to SVG coordinates relative to the given SVG element.
 *
 * @param {MouseEvent | PointerEvent} event - The pointer event.
 * @param {SVGSVGElement | Ref<SVGSVGElement>} svgElement - SVG element or Vue ref to the SVG element.
 * @returns {[number, number]} Coordinates in SVG space.
 */
export const getPointerCoordinates = (event, svgElement) => {
  // Handle Vue ref if passed
  const svg = svgElement.value || svgElement;
  const point = svg.createSVGPoint();

  point.x = event.clientX;
  point.y = event.clientY;

  const ctm = svg.getScreenCTM();
  if (!ctm) return [point.x, point.y];

  const transformedPoint = point.matrixTransform(ctm.inverse());

  return [transformedPoint.x, transformedPoint.y];
};

/**
 * Inserts interpolated points between existing points to ensure no gap exceeds threshold.
 *
 * @param {Array<[number, number]>} points - Original points.
 * @param {number} [threshold=10] - Max allowed distance between consecutive points.
 * @returns {Array<[number, number]>} New array with interpolated points included.
 */
export function interpolatePoints(points, options = 4) {
  if (!points || points.length < 2) return points;

  const normalizedOptions =
    typeof options === 'number'
      ? { threshold: options }
      : { threshold: 4, smoothness: 0.18, passes: 2, ...options };
  const threshold = Math.max(1, normalizedOptions.threshold || 4);

  const result = [points[0]];

  for (let i = 1; i < points.length; i++) {
    const [x1, y1] = points[i - 1];
    const [x2, y2] = points[i];

    const dx = x2 - x1;
    const dy = y2 - y1;
    const dist = Math.hypot(dx, dy);

    if (dist === 0) {
      // Points overlap; skip adding duplicates
      continue;
    }

    const steps = Math.floor(dist / threshold);
    const stepFraction = threshold / dist;

    for (let j = 1; j <= steps; j++) {
      const t = j * stepFraction;
      const xi = x1 + dx * t;
      const yi = y1 + dy * t;
      result.push([xi, yi]);
    }

    result.push([x2, y2]);
  }

  return smoothPoints(result, normalizedOptions);
}

function smoothPoints(points, options = {}) {
  const passes = Math.max(0, Number(options.passes || 0));
  const smoothness = Math.min(Math.max(Number(options.smoothness || 0), 0), 1);

  if (points.length < 3 || passes === 0 || smoothness === 0) {
    return points;
  }

  let nextPoints = points.map((point) => [...point]);

  for (let pass = 0; pass < passes; pass += 1) {
    nextPoints = nextPoints.map((point, index, allPoints) => {
      if (index === 0 || index === allPoints.length - 1) {
        return [...point];
      }

      const previous = allPoints[index - 1];
      const following = allPoints[index + 1];

      return [
        point[0] * (1 - smoothness) +
          ((previous[0] + following[0]) / 2) * smoothness,
        point[1] * (1 - smoothness) +
          ((previous[1] + following[1]) / 2) * smoothness,
      ];
    });
  }

  return nextPoints;
}

/**
 * Maps a value from one numeric range to another, with optional clamping.
 *
 * @param {number} value - The input value.
 * @param {[number, number]} rangeA - Source range [min, max].
 * @param {[number, number]} rangeB - Target range [min, max].
 * @param {boolean} [clamp=false] - Whether to clamp output within target range.
 * @returns {number} Mapped value.
 */
export function modulate(value, rangeA, rangeB, clamp = false) {
  const [fromLow, fromHigh] = rangeA;
  const [toLow, toHigh] = rangeB;

  if (fromHigh === fromLow) return toLow;

  const ratio = (value - fromLow) / (fromHigh - fromLow);
  const result = toLow + ratio * (toHigh - toLow);

  if (!clamp) return result;

  if (toLow < toHigh) {
    return Math.min(Math.max(result, toLow), toHigh);
  } else {
    return Math.min(Math.max(result, toHigh), toLow);
  }
}

/**
 * Returns stroke options customized by size.
 *
 * @param {{ size: number }} settings - Settings containing size.
 * @returns {object} Stroke options.
 */
export const getStrokeOptions = (settings) => ({
  size: settings.size,
  thinning: settings.tool === 'highlighter' ? 0.08 : 0.22,
  streamline: modulate(settings.size, [1, 24], [0.74, 0.86], true),
  smoothing: settings.tool === 'highlighter' ? 0.84 : 0.8,
  simulatePressure: settings.tool !== 'highlighter',
  easing: (t) => 1 - (1 - t) ** 2,
  start: {
    taper: 0,
    cap: true,
  },
  end: {
    taper: 0,
    cap: true,
  },
});

/**
 * Converts legacy line objects into the current format with explicit points.
 *
 * @param {Array} lines - Array of line objects.
 * @returns {Array} Converted lines with points array.
 */
export const convertLegacyLines = (lines) => {
  if (!lines || lines.length === 0) return [];

  return lines.map((line) => {
    if (line.points && Array.isArray(line.points)) return line;

    if (line.path || line.d) {
      const pathString = line.path || line.d;
      const points = extractPointsFromPath(pathString);

      return {
        points,
        tool: line.tool || 'pen',
        color: line.color || '#000000',
        size: line.size || 2,
        path: pathString,
        d: pathString,
      };
    }

    // Fallback, ensure points is array
    return {
      points: line.points || [],
      tool: line.tool || 'pen',
      color: line.color || '#000000',
      size: line.size || 2,
    };
  });
};

export function getRenderablePath(stroke) {
  if (!Array.isArray(stroke?.points) || stroke.points.length < 2) return '';

  if (stroke.tool === 'highlighter') {
    return getSmoothLinePath(stroke.points);
  }

  const outline = getStroke(stroke.points, getStrokeOptions(stroke));
  return getSvgPathFromStroke(outline);
}

export function getRenderableStrokeProps(stroke) {
  if (stroke?.tool === 'highlighter') {
    return {
      fill: 'none',
      stroke: stroke.color || DRAW_TOOL_DEFAULTS.highlighter.color,
      strokeWidth: stroke.size || DRAW_TOOL_DEFAULTS.highlighter.size,
      opacity: HIGHLIGHTER_OPACITY,
    };
  }

  return {
    fill: stroke?.color || DRAW_TOOL_DEFAULTS.pen.color,
    stroke: 'none',
    strokeWidth: 0,
    opacity: 1,
  };
}

/**
 * Extracts an array of points from an SVG path string containing coordinate pairs.
 *
 * @param {string} pathString - SVG path data string.
 * @returns {Array<[number, number]>} Extracted points.
 */
export const extractPointsFromPath = (pathString) => {
  if (!pathString) return [];

  const points = [];
  const matches = pathString.match(/-?\d*\.?\d+/g);

  if (matches) {
    for (let i = 0; i < matches.length - 1; i += 2) {
      points.push([parseFloat(matches[i]), parseFloat(matches[i + 1])]);
    }
  }

  return points;
};

/**
 * Converts current format lines back to legacy format with path strings.
 *
 * @param {Array} lines - Array of line objects.
 * @returns {Array} Legacy-format lines with path strings.
 */
export const convertToLegacyFormat = (lines) =>
  lines.map((line) => {
    const legacyLine = {
      tool: line.tool,
      color: line.color,
      size: line.size,
      points: line.points,
    };

    if (line.points && line.points.length > 0) {
      const lineGenerator = d3
        .line()
        .x((d) => d[0])
        .y((d) => d[1])
        .curve(d3.curveBasis);

      legacyLine.path = lineGenerator(line.points);
      legacyLine.d = legacyLine.path;
    }

    return legacyLine;
  });

/**
 * Calculates the bounding box of a line based on its points.
 *
 * @param {{ points: Array<[number, number]> }} line - Line object.
 * @returns {{ x: number, y: number, width: number, height: number }} Bounding rectangle.
 */
export const getLineBounds = (line) => {
  const points = line.points;
  if (!points || points.length === 0)
    return { x: 0, y: 0, width: 0, height: 0 };

  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;

  for (const [x, y] of points) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  };
};

/**
 * Transforms points by moving or scaling them to fit a new bounding box.
 *
 * @param {Array<[number, number]>} points - Points to transform.
 * @param {{ x: number, y: number, width: number, height: number }} originalBounds - Original bounding box.
 * @param {{ x: number, y: number, width: number, height: number }} newBounds - New bounding box.
 * @param {"move" | "scale"} transformType - Transformation type.
 * @returns {Array<[number, number]>} Transformed points.
 */
export const transformPoints = (
  points,
  originalBounds,
  newBounds,
  transformType
) => {
  if (!points || points.length === 0) return points;

  if (transformType === 'move') {
    const dx = newBounds.x - originalBounds.x;
    const dy = newBounds.y - originalBounds.y;
    return points.map(([px, py]) => [px + dx, py + dy]);
  }

  return points.map(([px, py]) => {
    const relativeX =
      originalBounds.width !== 0
        ? (px - originalBounds.x) / originalBounds.width
        : 0;
    const relativeY =
      originalBounds.height !== 0
        ? (py - originalBounds.y) / originalBounds.height
        : 0;

    return [
      newBounds.x + relativeX * newBounds.width,
      newBounds.y + relativeY * newBounds.height,
    ];
  });
};

/**
 * Check if pointer input is valid for drawing
 */
export const isPenInput = (e) => {
  return (
    e.pointerType === 'pen' ||
    e.pointerType === 'mouse' ||
    e.pointerType === 'touch'
  );
};

/**
 * Check if input is palm touch (should be ignored)
 */
export const isPalmTouch = (e) => {
  if (e.pointerType !== 'touch') return false;
  return (e.width || 0) > 35 || (e.height || 0) > 35;
};

/**
 * Get tool settings based on current tool
 */
export const getToolSettings = (
  tool,
  penSettings,
  eraserSettings,
  highlighterSettings
) => {
  switch (tool) {
    case 'pen':
      return penSettings;
    case 'eraser':
      return eraserSettings;
    case 'highlighter':
      return highlighterSettings;
    default:
      return penSettings;
  }
};

/**
 * Prevent touch scrolling on drawing canvas
 * @param {TouchEvent | PointerEvent} event - The touch/pointer event
 * @param {SVGSVGElement | Ref<SVGSVGElement>} svgRef - Vue ref or direct SVG element
 */
export const preventTouchScroll = (event, svgRef) => {
  if (event.touches && event.touches.length > 1) {
    return true;
  }

  // Handle Vue ref
  const svgElement = svgRef.value || svgRef;
  if (
    svgElement &&
    (event.target === svgElement || svgElement.contains(event.target))
  ) {
    event.preventDefault();
  }
};
