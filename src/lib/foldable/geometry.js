/**
 * Turns the platform's fold reading into a two-segment layout.
 * Pure: no DOM, no Tauri. Rect values are CSS pixels.
 */

function clamp(value, min, max) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(Math.max(n, min), max) : min;
}

function rect(left, top, width, height) {
  return { left, top, width, height };
}

/**
 * @param {object}   options
 * @param {object}   [options.state]            native FoldState, or null
 * @param {object}   options.viewport           { width, height } in CSS px
 * @param {boolean}  [options.fallbackFoldable] treat as foldable when native is absent
 * @returns {{ source: 'native'|'inferred'|'none', orientation: 'vertical'|'horizontal'|'none',
 *             crease: object|null, segments: object[], segmentWidth: number }}
 */
export function computeFoldLayout({ state, viewport, fallbackFoldable = false } = {}) {
  const width = Math.max(0, Number(viewport?.width) || 0);
  const height = Math.max(0, Number(viewport?.height) || 0);
  const full = [rect(0, 0, width, height)];

  if (!state?.foldable && !fallbackFoldable) {
    return {
      source: 'none',
      orientation: 'none',
      crease: null,
      segments: full,
      segmentWidth: width,
    };
  }

  const native = state?.crease;
  const source = native ? 'native' : 'inferred';
  const crease = native
    ? rect(
        clamp(native.left, 0, width),
        clamp(native.top, 0, height),
        clamp(native.width, 0, width),
        clamp(native.height, 0, height),
      )
    : rect(width / 2, 0, 0, height);

  // The split axis follows the crease's own shape, so a horizontal hinge
  // stacks the layout instead of narrowing it.
  const vertical = crease.width <= crease.height;
  const span = vertical ? crease.left : crease.top;
  const thickness = vertical ? crease.width : crease.height;
  const axisSize = vertical ? width : height;

  // A crease on or past an edge, or a zero-size viewport, has nothing to split.
  if (span <= 0 || span + thickness >= axisSize) {
    return { source, orientation: 'none', crease, segments: full, segmentWidth: width };
  }

  const segments = vertical
    ? [
        rect(0, 0, span, height),
        rect(span + thickness, 0, width - span - thickness, height),
      ]
    : [
        rect(0, 0, width, span),
        rect(0, span + thickness, width, height - span - thickness),
      ];

  return {
    source,
    orientation: vertical ? 'vertical' : 'horizontal',
    crease,
    segments,
    segmentWidth: Math.max(...segments.map((s) => s.width)),
  };
}
