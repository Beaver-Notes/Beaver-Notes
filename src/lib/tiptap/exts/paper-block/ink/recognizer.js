/** Shape recognition (hold-to-snap) and the hold detector. Pure geometry, no deps. */

const HOLD_MS = 500;
const HOLD_TRAVEL_PX = 2;

function dist([x1, y1], [x2, y2]) {
  return Math.hypot(x2 - x1, y2 - y1);
}

function dedupe(points) {
  const out = [points[0]];
  for (const p of points) {
    if (dist(out[out.length - 1], p) >= 0.5) out.push(p);
  }
  return out;
}

function shoelaceArea(pts) {
  let area = 0;
  for (let i = 0; i < pts.length; i += 1) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % pts.length];
    area += x1 * y2 - x2 * y1;
  }
  return Math.abs(area) / 2;
}

function bbox(pts) {
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  for (const [x, y] of pts) {
    minX = Math.min(minX, x); minY = Math.min(minY, y);
    maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
  }
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
}

/** Total absolute angle traversed around the centroid (radians). */
function revolve(pts, centroid) {
  let total = 0;
  let prev = null;
  for (const [x, y] of pts) {
    const a = Math.atan2(y - centroid[1], x - centroid[0]);
    if (prev !== null) {
      let d = Math.abs(a - prev);
      if (d > Math.PI) d = 2 * Math.PI - d;
      total += d;
    }
    prev = a;
  }
  return total;
}

/** Resample a polyline into `n` points spaced by arc length (closes the loop). */
function resample(pts, n = 48) {
  const segs = [];
  let total = 0;
  for (let i = 0; i < pts.length; i += 1) {
    const d = dist(pts[i], pts[(i + 1) % pts.length]);
    segs.push(d);
    total += d;
  }
  if (total === 0) return pts.slice(0, n);
  const out = [];
  let seg = 0;
  let segPos = 0;
  for (let i = 0; i < n; i += 1) {
    const target = (i / n) * total;
    while (seg < segs.length - 1 && segPos + segs[seg] < target) {
      segPos += segs[seg];
      seg += 1;
    }
    const t = segs[seg] > 0 ? (target - segPos) / segs[seg] : 0;
    const [x1, y1] = pts[seg % pts.length];
    const [x2, y2] = pts[(seg + 1) % pts.length];
    out.push([x1 + t * (x2 - x1), y1 + t * (y2 - y1)]);
  }
  return out;
}

/** Count sharp direction corners along an arc-length-resampled closed loop. */
function cornerCount(pts, turnThreshold = 0.9 /* rad */) {
  const samples = resample(pts, 48);
  let corners = 0;
  let clusterOpen = false;
  for (let i = 0; i < samples.length; i += 1) {
    const prev = samples[(i - 1 + samples.length) % samples.length];
    const next = samples[(i + 1) % samples.length];
    const cur = samples[i];
    const a1 = Math.atan2(cur[1] - prev[1], cur[0] - prev[0]);
    const a2 = Math.atan2(next[1] - cur[1], next[0] - cur[0]);
    let d = Math.abs(a2 - a1);
    if (d > Math.PI) d = 2 * Math.PI - d;
    if (d > turnThreshold) {
      if (!clusterOpen) { corners += 1; clusterOpen = true; }
    } else {
      clusterOpen = false;
    }
  }
  return corners;
}

/** Max perpendicular deviation from the chord [first..last], normalized by chord length. */
function chordDeviation(pts) {
  const [x1, y1] = pts[0];
  const [x2, y2] = pts[pts.length - 1];
  const len = Math.hypot(x2 - x1, y2 - y1);
  if (len === 0) return Infinity;
  let maxD = 0;
  for (const [x, y] of pts) {
    const d = Math.abs((y2 - y1) * x - (x2 - x1) * y + x2 * y1 - y2 * x1) / len;
    maxD = Math.max(maxD, d);
  }
  return maxD / len;
}

function snapLine(pts) {
  return [pts[0].slice(0, 2), pts[pts.length - 1].slice(0, 2)];
}

function snapArrow(pts, splitIdx) {
  const [sx, sy] = pts[0];
  const [ex, ey] = pts[splitIdx];
  const len = Math.hypot(ex - sx, ey - sy);
  const barb = Math.max(8, len * 0.2);
  const ang = Math.atan2(ey - sy, ex - sx);
  const b1 = ang + Math.PI - Math.PI / 6;
  const b2 = ang + Math.PI + Math.PI / 6;
  return [
    [sx, sy], [ex, ey],
    [ex + barb * Math.cos(b1), ey + barb * Math.sin(b1)],
    [ex + barb * Math.cos(b2), ey + barb * Math.sin(b2)],
  ];
}

/**
 * recognizeShape(points) -> null | { shape, snapped }.
 * Precedence: line → arrow → circle → rect → triangle → ellipse → null.
 * `snapped` encodes: line/arrow as vertex list; circle as [center, center+r·x̂];
 * rect/ellipse as bbox corners; triangle as 3 vertices.
 */
export function recognizeShape(rawPoints) {
  const points = dedupe((rawPoints ?? []).map((p) => [p[0], p[1]]));
  if (points.length < 6) return null;

  const pathLen = points.slice(1).reduce((acc, p, i) => acc + dist(points[i], p), 0);
  if (pathLen < 20) return null;

  const closed = dist(points[0], points[points.length - 1]) < 0.3 * pathLen;

  // Open shapes: straight line, or shaft+jab arrow.
  const deviation = chordDeviation(points);
  if (!closed && deviation < 0.06) {
    return { shape: 'line', snapped: snapLine(points) };
  }

  if (!closed) {
    const splitIdx = Math.floor(points.length * 0.8);
    const shaft = points.slice(0, splitIdx);
    if (shaft.length >= 4 && chordDeviation(shaft) < 0.08) {
      const [sx, sy] = shaft[0];
      const [ex, ey] = shaft[shaft.length - 1];
      const shaftAng = Math.atan2(ey - sy, ex - sx);
      const jab = points.slice(splitIdx);
      const jabAng = Math.atan2(
        jab[jab.length - 1][1] - jab[0][1],
        jab[jab.length - 1][0] - jab[0][0],
      );
      let dAng = Math.abs(jabAng - shaftAng);
      if (dAng > Math.PI) dAng = 2 * Math.PI - dAng;
      const jabLen = jab.reduce((acc, p, i) => acc + dist(jab[Math.max(0, i - 1)], p), 0);
      if (dAng > Math.PI / 6 && jabLen < 0.45 * pathLen) {
        return { shape: 'arrow', snapped: snapArrow(points, splitIdx) };
      }
    }
    return null;
  }

  // Closed shapes: need a full-ish revolution around the centroid.
  const cx = points.reduce((a, p) => a + p[0], 0) / points.length;
  const cy = points.reduce((a, p) => a + p[1], 0) / points.length;
  const rev = revolve(points, [cx, cy]);
  if (rev < 5.2) return null; // ~300°: arcs and hooks are not shapes

  const box = bbox(points);
  const areaRatio = shoelaceArea(points) / Math.max(1, box.w * box.h);

  // Circle: round bbox and low radial variance.
  const radii = points.map(([x, y]) => Math.hypot(x - cx, y - cy));
  const rMean = radii.reduce((a, r) => a + r, 0) / radii.length;
  const rStd = Math.sqrt(radii.reduce((a, r) => a + (r - rMean) ** 2, 0) / radii.length);
  const aspect = Math.max(box.w, box.h) / Math.max(1, Math.min(box.w, box.h));
  if (aspect < 1.2 && rStd / rMean < 0.18) {
    return { shape: 'circle', snapped: [[cx, cy], [cx + rMean, cy]] };
  }

  // Rect: boxy area fill and 4 corners; Triangle: 3 corners.
  const corners = cornerCount(points);
  if (areaRatio > 0.82 && corners >= 3 && corners <= 5) {
    return {
      shape: 'rect',
      snapped: [[box.minX, box.minY], [box.maxX, box.maxY]],
    };
  }
  if (corners === 3) {
    return {
      shape: 'triangle',
      snapped: [[(box.minX + box.maxX) / 2, box.minY], [box.minX, box.maxY], [box.maxX, box.maxY]],
    };
  }

  // Ellipse: the remaining round-ish closed form.
  if (areaRatio > 0.55) {
    return { shape: 'ellipse', snapped: [[box.minX, box.minY], [box.maxX, box.maxY]] };
  }

  return null;
}

/**
 * Hold-to-snap: true once the pointer has stayed within `HOLD_TRAVEL_PX` for
 * `HOLD_MS` — `points` is the in-progress stroke, `events` the recent pointer
 * samples (ascending time) since stroke start.
 */
export function shouldSnapshot(points, events) {
  if (!points.length || !events?.length) return false;
  let lastMove = events[0];
  for (const e of events) {
    if (dist([e.clientX, e.clientY], [lastMove.clientX, lastMove.clientY]) >= HOLD_TRAVEL_PX) {
      lastMove = e;
    }
  }
  const now = events[events.length - 1].timeStamp;
  return now - lastMove.timeStamp >= HOLD_MS;
}
