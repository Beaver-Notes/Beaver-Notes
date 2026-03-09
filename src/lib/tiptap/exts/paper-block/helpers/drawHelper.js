// drawHelper.js (Vue version)
import * as d3 from 'd3';

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

  let path = `M${points[0][0]},${points[0][1]}`;

  // Use Catmull-Rom to Bezier conversion for smooth curves.
  for (let i = 1; i < points.length - 2; i++) {
    const [x0, y0] = points[i - 1];
    const [x1, y1] = points[i];
    const [x2, y2] = points[i + 1];
    const [x3, y3] = points[i + 2];

    const cp1x = x1 + (x2 - x0) / 6;
    const cp1y = y1 + (y2 - y0) / 6;
    const cp2x = x2 - (x3 - x1) / 6;
    const cp2y = y2 - (y3 - y1) / 6;

    path += ` C${cp1x},${cp1y},${cp2x},${cp2y},${x2},${y2}`;
  }

  return path;
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
export function interpolatePoints(points, threshold = 10) {
  if (!points || points.length < 2) return points;

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

  return result;
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
  thinning: 0,
  streamline: modulate(settings.size, [9, 16], [0.64, 0.74], true),
  smoothing: 0.62,
  simulatePressure: false,
  easing: (t) => t,
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
  return e.pointerType === 'pen' || e.pointerType === 'mouse';
};

/**
 * Check if input is palm touch (should be ignored)
 */
export const isPalmTouch = (e) => {
  return e.pointerType === 'touch';
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
