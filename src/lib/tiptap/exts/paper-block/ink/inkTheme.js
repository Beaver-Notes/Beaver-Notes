/**
 * ink/inkTheme.js — theme-adaptive monochrome ink (display only).
 *
 * Drawing blocks render on the note surface, so black ink must flip to white
 * in dark mode (and white ink to black in light mode) or the drawing vanishes.
 * Colored ink is never touched, and stored strokes are never rewritten: the
 * mapping happens at paint time, on a copy.
 *
 * Pure. The only state is the paint mapper the host views publish, exactly
 * like ink/uiLock.js publishes the stroke lock.
 */

const NEAR_BLACK = 0.25; // luminance below this reads as black ink
const NEAR_WHITE = 0.85; // luminance above this reads as white ink
const INK_WHITE = '#ffffff';
const INK_BLACK = '#000000';

function parseColor(color) {
  if (typeof color !== 'string') return null;
  const hex = color.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex) {
    const h = hex[1];
    return h.length === 3
      ? [parseInt(h[0] + h[0], 16), parseInt(h[1] + h[1], 16), parseInt(h[2] + h[2], 16)]
      : [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  const rgb = color.match(/^rgba?\(([^)]+)\)$/i);
  if (rgb) {
    const parts = rgb[1].split(/[\s,/]+/).map(Number);
    if (parts.length >= 3 && parts.slice(0, 3).every(Number.isFinite)) return parts.slice(0, 3);
  }
  return null;
}

/** Perceived brightness (0–1); no gamma, monochrome detection only. */
function luminance([r, g, b]) {
  return (r * 299 + g * 587 + b * 114) / 255000;
}

/** Display color for one ink: swap near-black/near-white with the theme. */
export function inkDisplayColor(color, isDark) {
  const rgb = parseColor(color);
  if (!rgb) return color;
  const l = luminance(rgb);
  if (isDark && l < NEAR_BLACK) return INK_WHITE;
  if (!isDark && l > NEAR_WHITE) return INK_BLACK;
  return color;
}

/** Display copy of a stroke list: same array and objects where nothing swaps. */
export function displayStrokes(strokes, isDark) {
  if (!Array.isArray(strokes) || !strokes.length) return strokes ?? [];
  const mapped = strokes.map((stroke) => {
    const color = inkDisplayColor(stroke?.color, isDark);
    return color === stroke?.color ? stroke : { ...stroke, color };
  });
  return mapped.every((stroke, i) => stroke === strokes[i]) ? strokes : mapped;
}

let paintMapper = (color) => color;

/** Host views publish the theme's mapper once per theme change. */
export function setInkPaintMapper(map) {
  paintMapper = typeof map === 'function' ? map : (color) => color;
}

/** Paint-time resolution used by every fill primitive (live + committed). */
export function paintInkColor(color) {
  return paintMapper(color);
}