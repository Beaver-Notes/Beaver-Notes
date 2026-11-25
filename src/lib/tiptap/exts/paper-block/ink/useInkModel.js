/**
 * useInkModel.js — snapshot/undo primitives (REDESIGN phase D).
 *
 * `actions` = pure names (`move`, `select`, `erase`, `pen`, `shape`, `zoom`)
 * fed to snapshot/undo logic; `inkModel` = `{ strokes: [], strokesBounds: [] }`.
 *
 * `generateSnapshot(inkModel, selectionIds)` → `{ strokes, bounds, selectionIds }`
 * `restoreSnapshot({ strokes, bounds }, selectionIds)` → `{ strokes, strokesBounds, selectionIds }`
 */

import { strokeBounds as strokeBoundsOf } from './stroke-model.js';

export const actions = Object.freeze(['move', 'select', 'erase', 'pen', 'shape', 'zoom']);

export function generateSnapshot(inkModel, selectionIds) {
  return {
    strokes: Array.isArray(inkModel?.strokes) ? [...inkModel.strokes] : [],
    bounds: Array.isArray(inkModel?.strokesBounds) ? [...inkModel.strokesBounds] : [],
    selectionIds: Array.isArray(selectionIds) ? [...selectionIds] : [],
  };
}

export function restoreSnapshot(snapshot, selectionIds) {
  const strokes = Array.isArray(snapshot?.strokes) ? snapshot.strokes : [];
  const bounds = Array.isArray(snapshot?.bounds)
    ? snapshot.bounds
    : strokes.map((s) => (s && s.points ? strokeBoundsOf(s) : { minX: 0, minY: 0, maxX: 0, maxY: 0 }));
  return {
    strokes,
    strokesBounds: bounds,
    selectionIds: Array.isArray(selectionIds) ? selectionIds : [],
  };
}
