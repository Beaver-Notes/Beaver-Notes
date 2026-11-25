/**
 * inkModel3.js — stroke replacement + id uniqueness (REDESIGN phase B).
 *
 * `replaceStrokes(strokes, replaceIds, replacement)` → `{ strokes, bounds }`.
 * `ensureUniqueIds(strokes)` → suffix duplicates (`id_2`) — guards paste
 * collisions.
 */

import { strokeBounds } from './stroke-model.js';

export function replaceStrokes(strokes, replaceIds, replacement) {
  const idSet = new Set(replaceIds ?? []);
  const next = [];
  for (let i = 0; i < (strokes ?? []).length; i++) {
    const s = strokes[i];
    if (idSet.has(s.id)) continue;
    next.push(s);
  }
  if (replacement) {
    const reps = Array.isArray(replacement) ? replacement : [replacement];
    next.push(...reps);
  }
  return { strokes: next, bounds: next.map((s) => strokeBounds(s)) };
}

export function ensureUniqueIds(strokes) {
  const seen = new Map();
  const next = [];
  for (const s of strokes ?? []) {
    const id = s.id;
    if (!seen.has(id)) {
      seen.set(id, 1);
      next.push(s);
      continue;
    }
    const n = seen.get(id);
    seen.set(id, n + 1);
    next.push({ ...s, id: `${id}_${n + 1}` });
  }
  return next;
}
