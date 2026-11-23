/**
 * geometry.js — hit-testing primitives for ink selection. Pure.
 */

/**
 * Even-odd ray casting: is (x, y) inside the closed polygon [[x, y], ...]?
 * Returns false for degenerate input instead of throwing — a lasso polygon
 * with two samples must never break the selection path.
 */
export function pointInPolygon(x, y, polygon) {
  if (!Array.isArray(polygon) || polygon.length < 3) return false;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    if (!Array.isArray(a) || !Array.isArray(b)) return false;
    const [xi, yi] = a;
    const [xj, yj] = b;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}