/**
 * pdfMarkup.js — pure geometry mapping between stored page-local markup
 * strokes and the two presentation spaces:
 *
 *   rail  (PdfBlockComponent's inline strip: all pages laid side by side)
 *   editor viewport (MarkupEditor: one page centered, overlay spans viewport)
 *
 * Stored model: each stroke carries `page` (0-based) and points in that
 * page's coordinate space; x may exceed [0, pageWidth] (margin spill).
 */
import { strokeBounds } from '../paper-block/ink/stroke-model.js';

export const RAIL_PAGE_GAP = 8;

/** pages: [{width, height}] → [{page, x, width, height, scale}] */
export function railLayout(pages, railHeight, gap = RAIL_PAGE_GAP) {
  let x = 0;
  return pages.map(({ width, height }, page) => {
    const scale = railHeight / height;
    const entry = { page, x, width: width * scale, height: railHeight, scale };
    x += entry.width + gap;
    return entry;
  });
}

function entryForX(layout, x) {
  for (let i = layout.length - 1; i >= 1; i -= 1) {
    // a point past the previous page's right edge + half the gap has
    // crossed onto this page
    if (x >= layout[i].x - RAIL_PAGE_GAP / 2) return layout[i];
  }
  return layout[0];
}

/** stored page-local strokes → rail-space strokes (for display). */
export function strokesToRail(strokes, layout) {
  return strokes.map((stroke) => {
    const entry = layout[stroke.page] ?? layout[0];
    if (!entry) return stroke;
    return {
      ...stroke,
      points: stroke.points.map(([x, y, p]) => [
        entry.x + x * entry.scale,
        y * entry.scale,
        p,
      ]),
    };
  });
}

/**
 * One rail-space stroke → stored page-local strokes, split at page
 * boundaries (ids get a `_p<page>` suffix). Shapes don't survive a split.
 */
export function railStrokeToStored(railStroke, layout) {
  if (!layout.length) return [];
  const { shape, ...rest } = railStroke;
  const runs = [];
  let current = null;
  let prev = null;
  for (const point of railStroke.points) {
    const entry = entryForX(layout, point[0]);
    if (!current) {
      current = { page: entry.page, points: [] };
      runs.push(current);
    } else if (current.page !== entry.page) {
      const boundaryX = entry.x;
      const t =
        point[0] === prev[0]
          ? 0
          : (boundaryX - prev[0]) / (point[0] - prev[0]);
      const by = prev[1] + (point[1] - prev[1]) * t;
      const bp = prev[2] + (point[2] - prev[2]) * t;
      const from = layout[current.page];
      current.points.push([from.width / from.scale, by / from.scale, bp]);
      current = { page: entry.page, points: [[0, by / entry.scale, bp]] };
      runs.push(current);
    }
    current.points.push([
      (point[0] - entry.x) / entry.scale,
      point[1] / entry.scale,
      point[2],
    ]);
    prev = point;
  }
  return runs
    .filter((run) => run.points.length >= 2)
    .map((run) => ({
      ...rest,
      id: runs.length === 1 ? railStroke.id : `${railStroke.id}_p${run.page}`,
      ...(runs.length === 1 && shape ? { shape } : {}),
      page: run.page,
      points: run.points,
    }));
}

/** All strokes for one page (strokes without a page field belong to page 0). */
export function pageStrokes(strokes, page) {
  return strokes.filter((stroke) => (stroke.page ?? 0) === page);
}

/** Shift every stroke's x by dx (stored ↔ viewport mapping). */
export function offsetStrokes(strokes, dx) {
  return strokes.map((stroke) => ({
    ...stroke,
    points: stroke.points.map(([x, y, p]) => [x + dx, y, p]),
  }));
}

/** Union bounds of strokes, used for spill-aware canvas sizing. */
export function strokesBounds(strokes) {
  if (!strokes.length) return null;
  return strokes.reduce(
    (acc, stroke) => {
      const b = strokeBounds(stroke);
      return {
        minX: Math.min(acc.minX, b.minX),
        minY: Math.min(acc.minY, b.minY),
        maxX: Math.max(acc.maxX, b.maxX),
        maxY: Math.max(acc.maxY, b.maxY),
      };
    },
    { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
  );
}
