/**
 * Canonical v3 stroke: { id, tool, color, size, opacity, shape?, points: [[x, y, pressure], …] }.
 * Pure module — no DOM imports — so it runs in tests, node views, and export code alike.
 */

export const STROKE_TOOLS = ['pen', 'pencil', 'fountain', 'marker', 'eraser', 'lasso'];

/** Per-tool defaults, carried over verbatim from the old `cloneDrawingToolDefaults`. */
export const TOOL_DEFAULTS = {
  pen: { color: '#1a1a1a', size: 4, opacity: 1 },
  pencil: { color: '#4a4a4a', size: 3 },
  fountain: { color: '#1a2744', size: 5 },
  marker: { color: '#fbbf24', size: 16, opacity: 0.35 },
  eraser: { size: 20 },
};

/** Legacy tool names that carried meaning into v3. */
const TOOL_ALIASES = { highlighter: 'marker' };

const DEFAULT_OPACITY_BY_TOOL = { marker: 0.35, highlighter: 0.35 };

function normalizeStroke(line, idx) {
  const tool = TOOL_ALIASES[line.tool] ?? line.tool ?? 'pen';
  return {
    id: line.id ?? `migrated-${idx}`,
    tool,
    color: line.color ?? '#000000',
    size: line.size ?? 4,
    opacity: line.opacity ?? (DEFAULT_OPACITY_BY_TOOL[tool] ?? 1),
    ...(line.shape ? { shape: line.shape } : {}),
    ...(Number.isFinite(line.page) ? { page: line.page } : {}),
    points: (line.points ?? []).map((pt) =>
      pt.length >= 3 ? [pt[0], pt[1], pt[2]] : [pt[0], pt[1], 0.5],
    ),
  };
}

/**
 * Accepts v3, v2, and v1 payloads (arrays of line objects; legacy 2-tuple points
 * get 0.5 pressure) and returns canonical v3 strokes. `raw` may be null/undefined.
 */
export function migrateStrokes(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.map(normalizeStroke);
}

/** Parses stored JSON (or a pass-through array) into v3 strokes; never throws. */
export function parseStrokes(json) {
  if (!json) return [];
  if (Array.isArray(json)) return migrateStrokes(json);
  if (typeof json !== 'string') return [];
  try {
    const parsed = JSON.parse(json);
    return migrateStrokes(parsed);
  } catch {
    return [];
  }
}

export function serializeStrokes(strokes) {
  return JSON.stringify(strokes ?? []);
}

export function strokeBounds(stroke) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of stroke.points) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
}
