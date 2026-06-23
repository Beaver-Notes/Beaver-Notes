/**
 * freehand.js — tldraw-quality stroke engine
 *
 * Direct ports of tldraw's freehand pipeline:
 *   getStrokePoints        → stroke point generation with streamlining
 *   setStrokePointRadii    → per-point radius from pressure + thinning + taper
 *   getStrokeOutlineTracks → left/right outline with sharp-corner detection
 *   getStrokeOutlinePoints → caps + winding order
 *   svgInk                 → final SVG path via elbow partitioning + smooth Bézier
 */

// ============================================================================
// Vec2 — tldraw-compatible 2D vector class
// ============================================================================

class Vec2 {
  constructor(x = 0, y = 0, z = 0) {
    this.x = x;
    this.y = y;
    this.z = z;
  }

  static From(a) {
    return new Vec2(a[0], a[1], a[2] ?? 0.5);
  }
  static Add(a, b) {
    return new Vec2(a.x + b.x, a.y + b.y, a.z);
  }
  static Sub(a, b) {
    return new Vec2(a.x - b.x, a.y - b.y, a.z);
  }
  static Mul(a, s) {
    return new Vec2(a.x * s, a.y * s, a.z);
  }
  static Dist(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }
  static Dist2(a, b) {
    const d = Vec2.Sub(a, b);
    return d.x * d.x + d.y * d.y;
  }
  static Lrp(a, b, t) {
    return new Vec2(
      a.x + (b.x - a.x) * t,
      a.y + (b.y - a.y) * t,
      a.z + (b.z - a.z) * t
    );
  }
  static RotWith(pt, center, angle) {
    const dx = pt.x - center.x,
      dy = pt.y - center.y;
    const c = Math.cos(angle),
      s = Math.sin(angle);
    return new Vec2(center.x + dx * c - dy * s, center.y + dx * s + dy * c);
  }

  clone() {
    return new Vec2(this.x, this.y, this.z);
  }
  equals(o) {
    return this.x === o.x && this.y === o.y;
  }
  len() {
    return Math.hypot(this.x, this.y);
  }
  uni() {
    const l = this.len() || 1;
    return new Vec2(this.x / l, this.y / l);
  }
  per() {
    return new Vec2(this.y, -this.x);
  }
  neg() {
    return new Vec2(-this.x, -this.y);
  }
  dpr(o) {
    return this.x * o.x + this.y * o.y;
  }
  cpr(o) {
    return this.x * o.y - this.y * o.x;
  }
  add(o) {
    this.x += o.x;
    this.y += o.y;
    return this;
  }
  sub(o) {
    this.x -= o.x;
    this.y -= o.y;
    return this;
  }
  mul(s) {
    this.x *= s;
    this.y *= s;
    return this;
  }
  lrp(o, t) {
    this.x += (o.x - this.x) * t;
    this.y += (o.y - this.y) * t;
    return this;
  }

  toArr() {
    return [this.x, this.y, this.z];
  }
}

// ============================================================================
// Freehand options (from tldraw's getPath.ts)
// ============================================================================

const EASINGS = {
  easeOutSine: (t) => Math.sin((t * Math.PI) / 2),
  linear: (t) => t,
};
const PEN_EASING = (t) => t * 0.65 + Math.sin((t * Math.PI) / 2) * 0.35;

export function getFreehandOptions(tool, size, { isComplete = true } = {}) {
  if (tool === 'highlighter') {
    return {
      size: 1 + size,
      thinning: 0,
      smoothing: 0.5,
      streamline: 0.5,
      simulatePressure: false,
      last: isComplete,
      start: { cap: false, taper: 0 },
      end: { cap: false, taper: 0 },
    };
  }
  if (tool === 'pencil') {
    return {
      size: size * 0.9,
      thinning: 0.75,
      smoothing: 0.3,
      streamline: 0.38,
      simulatePressure: true,
      easing: EASINGS.easeOutSine,
      last: isComplete,
      start: { cap: true, taper: isComplete ? Math.max(size, 12) : 0 },
      end: { cap: true, taper: isComplete ? Math.max(size, 18) : 0 },
    };
  }
  if (tool === 'fountain') {
    return {
      size: size * 1.05,
      thinning: 0.35,
      smoothing: 0.75,
      streamline: 0.75,
      simulatePressure: true,
      easing: PEN_EASING,
      last: isComplete,
      start: { cap: true, taper: isComplete ? Math.max(size, 20) : 0 },
      end: { cap: true, taper: isComplete ? Math.max(size, 28) : 0 },
    };
  }
  // Pen — uniform line, no pressure variation
  return {
    size,
    thinning: 0,
    smoothing: 0.65,
    streamline: 0.68,
    simulatePressure: false,
    easing: EASINGS.linear,
    last: isComplete,
    start: { cap: true, taper: isComplete ? Math.max(size, 16) : 0 },
    end: { cap: true, taper: isComplete ? Math.max(size, 24) : 0 },
  };
}

// ============================================================================
// getStrokePoints (from tldraw's getStrokePoints.ts)
// ============================================================================

const MIN_PRESSURE = 0.025;

export function getStrokePoints(rawInputPoints, options = {}) {
  const {
    streamline = 0.5,
    size = 16,
    simulatePressure = false,
    last = true,
  } = options;
  if (!rawInputPoints || rawInputPoints.length === 0) return [];

  const t = 0.15 + (1 - streamline) * 0.85;
  let pts = rawInputPoints.map(Vec2.From);

  if (!simulatePressure) {
    for (const pt of pts) {
      if (pt.z < MIN_PRESSURE) pt.z = MIN_PRESSURE;
    }
  }

  if (pts.length === 0) {
    return [
      makeSP(
        Vec2.From(rawInputPoints[0]),
        Vec2.From(rawInputPoints[0]),
        simulatePressure ? 0.5 : 0.15,
        new Vec2(1, 1),
        0,
        0
      ),
    ];
  }

  let pt = pts[1];
  while (pt) {
    if (Vec2.Dist2(pt, pts[0]) > (size / 3) ** 2) break;
    pts[0].z = Math.max(pts[0].z, pt.z);
    pts.splice(1, 1);
    pt = pts[1];
  }

  const lastPt = pts.pop();
  pt = pts[pts.length - 1];
  let pointsRemovedFromNearEnd = 0;
  while (pt) {
    if (Vec2.Dist2(pt, lastPt) > (size / 3) ** 2) break;
    pts.pop();
    pt = pts[pts.length - 1];
    pointsRemovedFromNearEnd++;
  }
  pts.push(lastPt);

  const isComplete =
    last ||
    !simulatePressure ||
    (pts.length > 1 &&
      Vec2.Dist2(pts[pts.length - 1], pts[pts.length - 2]) < size ** 2) ||
    pointsRemovedFromNearEnd > 0;

  if (pts.length === 2 && simulatePressure) {
    const end = pts[1];
    pts = pts.slice(0, -1);
    for (let i = 1; i < 5; i++) {
      const next = Vec2.Lrp(pts[0], end, i / 4);
      next.z = ((pts[0].z + (end.z - pts[0].z)) * i) / 4;
      pts.push(next);
    }
  }

  const strokePoints = [
    makeSP(
      pts[0],
      pts[0],
      simulatePressure ? 0.5 : pts[0].z,
      new Vec2(1, 1),
      0,
      0
    ),
  ];
  let totalLength = 0,
    prev = strokePoints[0];

  if (isComplete && streamline > 0) {
    pts.push(pts[pts.length - 1].clone());
  }

  for (let i = 1, n = pts.length; i < n; i++) {
    const point =
      !t || (last && i === n - 1)
        ? pts[i].clone()
        : pts[i].clone().lrp(prev.point, 1 - t);
    if (prev.point.equals(point)) continue;
    const distance = Vec2.Dist(point, prev.point);
    totalLength += distance;
    if (i < 4 && totalLength < size) continue;
    prev = makeSP(
      point,
      pts[i],
      simulatePressure ? 0.5 : pts[i].z,
      Vec2.Sub(prev.point, point).uni(),
      distance,
      totalLength
    );
    strokePoints.push(prev);
  }

  if (strokePoints[1]?.vector)
    strokePoints[0].vector = strokePoints[1].vector.clone();
  if (totalLength < 1) {
    const maxP = Math.max(0.5, ...strokePoints.map((s) => s.pressure));
    strokePoints.forEach((s) => {
      s.pressure = maxP;
    });
  }
  return strokePoints;
}

function makeSP(point, input, pressure, vector, distance, runningLength) {
  return { point, input, pressure, vector, distance, runningLength, radius: 1 };
}

// ============================================================================
// setStrokePointRadii (from tldraw's setStrokePointRadii.ts)
// ============================================================================

export function setStrokePointRadii(strokePoints, options = {}) {
  const {
    size = 16,
    thinning = 0.5,
    simulatePressure = false,
    easing = (t) => t,
    start = {},
    end = {},
  } = options;
  const { taper: startTaper = 0 } = start,
    { taper: endTaper = 0 } = end;
  const len = strokePoints.length;
  if (len === 0) return strokePoints;
  const totalLength = strokePoints[len - 1].runningLength;
  for (let i = 0; i < len; i++) {
    const sp = strokePoints[i],
      { pressure, runningLength } = sp;
    const t = easing(pressure);
    let radius = (size / 2) * (thinning * t + (1 - thinning));
    if (startTaper > 0 && runningLength < startTaper)
      radius *= Math.sin((runningLength / startTaper) * (Math.PI / 2));
    if (endTaper > 0) {
      const dfe = totalLength - runningLength;
      if (dfe < endTaper) radius *= Math.sin((dfe / endTaper) * (Math.PI / 2));
    }
    sp.radius = Math.max(0.01, radius);
  }
  return strokePoints;
}

// ============================================================================
// getStrokeOutlineTracks (from tldraw)
// ============================================================================

const FIXED_PI = Math.PI + 0.0001;

function getStrokeOutlineTracks(strokePoints, options = {}) {
  const { size = 16, smoothing = 0.5 } = options;
  if (strokePoints.length === 0 || size <= 0) return { left: [], right: [] };
  const lastSP = strokePoints[strokePoints.length - 1];
  const totalLength = lastSP.runningLength;
  const minDistance = (size * smoothing) ** 2;
  const leftPts = [],
    rightPts = [];
  let prevVector = strokePoints[0].vector;
  let pl = strokePoints[0].point,
    pr = pl,
    tl = pl,
    tr = pr;
  let isPrevPointSharpCorner = false;

  for (let i = 0; i < strokePoints.length; i++) {
    const sp = strokePoints[i],
      { point, vector } = sp;
    const prevDpr = sp.vector.dpr(prevVector);
    const nextVector = (
      i < strokePoints.length - 1 ? strokePoints[i + 1] : strokePoints[i]
    ).vector;
    const nextDpr = i < strokePoints.length - 1 ? nextVector.dpr(sp.vector) : 1;
    const isPointSharpCorner = prevDpr < 0 && !isPrevPointSharpCorner;
    const isNextPointSharpCorner = nextDpr !== null && nextDpr < 0.2;

    if (isPointSharpCorner || isNextPointSharpCorner) {
      if (nextDpr > -0.62 && totalLength - sp.runningLength > sp.radius) {
        const offset = prevVector.clone().mul(sp.radius);
        const cpr = prevVector.clone().cpr(nextVector);
        if (cpr < 0) {
          tl = Vec2.Add(point, offset);
          tr = Vec2.Sub(point, offset);
        } else {
          tl = Vec2.Sub(point, offset);
          tr = Vec2.Add(point, offset);
        }
        leftPts.push(tl);
        rightPts.push(tr);
      } else {
        const offset = prevVector.clone().mul(sp.radius).per();
        const start = Vec2.Sub(sp.input, offset);
        for (let step = 1 / 13, t = 0; t < 1; t += step) {
          leftPts.push(Vec2.RotWith(start, sp.input, FIXED_PI * t));
          rightPts.push(
            Vec2.RotWith(start, sp.input, FIXED_PI + FIXED_PI * -t)
          );
        }
      }
      pl = tl;
      pr = tr;
      if (isNextPointSharpCorner) isPrevPointSharpCorner = true;
      continue;
    }
    isPrevPointSharpCorner = false;

    if (sp === strokePoints[0] || sp === lastSP) {
      const offset = vector.per().mul(sp.radius);
      leftPts.push(Vec2.Sub(point, offset));
      rightPts.push(Vec2.Add(point, offset));
      continue;
    }

    const offset = Vec2.Lrp(nextVector, vector, nextDpr).per().mul(sp.radius);
    tl = Vec2.Sub(point, offset);
    if (i <= 1 || Vec2.Dist2(pl, tl) > minDistance) {
      leftPts.push(tl);
      pl = tl;
    }
    tr = Vec2.Add(point, offset);
    if (i <= 1 || Vec2.Dist2(pr, tr) > minDistance) {
      rightPts.push(tr);
      pr = tr;
    }
    prevVector = vector;
  }
  return { left: leftPts, right: rightPts };
}

// ============================================================================
// Elbow partitioning + SVG path (from tldraw's svgInk.ts)
// ============================================================================

function partitionAtElbows(strokePoints) {
  if (strokePoints.length <= 2) return [strokePoints];
  const result = [];
  let current = [strokePoints[0]];
  let prevV = Vec2.Sub(strokePoints[1].point, strokePoints[0].point).uni();

  for (let i = 1, n = strokePoints.length; i < n - 1; i++) {
    const thisPt = strokePoints[i],
      nextPt = strokePoints[i + 1];
    const nextV = Vec2.Sub(nextPt.point, thisPt.point).uni();
    const dpr = prevV.dpr(nextV);
    prevV = nextV;

    if (dpr < -0.8) {
      current.push({ ...thisPt, point: thisPt.input });
      result.push(cleanUpPartition(current));
      current = [{ ...thisPt, point: thisPt.input }];
      continue;
    }
    current.push(thisPt);
    if (dpr > 0.7) continue;
    if (
      (Vec2.Dist2(thisPt.point, strokePoints[i - 1].point) +
        Vec2.Dist2(thisPt.point, strokePoints[i + 1].point)) /
        ((strokePoints[i - 1].radius +
          thisPt.radius +
          strokePoints[i + 1].radius) /
          3) **
          2 <
      1.5
    ) {
      current.push(thisPt);
      result.push(cleanUpPartition(current));
      current = [thisPt];
    }
  }
  current.push(strokePoints[strokePoints.length - 1]);
  result.push(cleanUpPartition(current));
  return result;
}

function cleanUpPartition(partition) {
  const s = partition[0];
  while (partition.length > 2) {
    if (
      Vec2.Dist2(s.point, partition[1].point) <
      (((s.radius + partition[1].radius) / 2) * 0.5) ** 2
    )
      partition.splice(1, 1);
    else break;
  }
  const e = partition[partition.length - 1];
  while (partition.length > 2) {
    if (
      Vec2.Dist2(e.point, partition[partition.length - 2].point) <
      (((e.radius + partition[partition.length - 2].radius) / 2) * 0.5) ** 2
    )
      partition.splice(partition.length - 2, 1);
    else break;
  }
  if (partition.length > 1) {
    partition[0] = {
      ...partition[0],
      vector: Vec2.Sub(partition[1].point, partition[0].point).uni(),
    };
    const last = partition.length - 1;
    partition[last] = {
      ...partition[last],
      vector: Vec2.Sub(partition[last].point, partition[last - 1].point).uni(),
    };
  }
  return partition;
}

function precise(pt) {
  return `${pt.x.toFixed(2)},${pt.y.toFixed(2)}`;
}
function average(a, b) {
  return `${((a.x + b.x) / 2).toFixed(2)},${((a.y + b.y) / 2).toFixed(2)} `;
}
function circlePath(cx, cy, r) {
  return `M${cx} ${cy} m -${r},0 a ${r},${r} 0 1,1 ${
    r * 2
  },0 a ${r},${r} 0 1,1 -${r * 2},0 `;
}

/**
 * Render a stroke to an SVG path `d` string — tldraw's svgInk with smooth Bézier.
 */
export function getRenderablePath(stroke, isComplete = true) {
  if (!Array.isArray(stroke?.points) || stroke.points.length < 2) return '';
  const opts = getFreehandOptions(stroke.tool, stroke.size ?? 4, {
    isComplete,
  });
  const strokePoints = getStrokePoints(stroke.points, opts);
  setStrokePointRadii(strokePoints, opts);
  const partitions = partitionAtElbows(strokePoints);
  let svg = '';
  for (const part of partitions) svg += renderPartition(part);
  return svg;
}

function renderPartition(pts) {
  if (pts.length === 0) return '';
  if (pts.length === 1) {
    const sp = pts[0];
    return circlePath(sp.point.x, sp.point.y, Math.max(0.5, sp.radius));
  }

  const { left, right } = getStrokeOutlineTracks(pts);
  right.reverse();
  let d = `M${precise(left[0])}T`;

  for (let i = 1; i < left.length; i++) d += average(left[i - 1], left[i]);

  {
    const pt = pts[pts.length - 1],
      r = pt.radius;
    const dir = pt.vector.clone().per().neg();
    d += `${precise(Vec2.Add(pt.point.clone(), Vec2.Mul(dir, r)))}A${r.toFixed(
      2
    )},${r.toFixed(2)} 0 0 1 ${precise(
      Vec2.Add(pt.point.clone(), Vec2.Mul(dir, -r))
    )}T`;
  }

  for (let i = 1; i < right.length; i++) d += average(right[i - 1], right[i]);

  {
    const pt = pts[0],
      r = pt.radius;
    const dir = pt.vector.clone().per();
    d += `${precise(Vec2.Add(pt.point.clone(), Vec2.Mul(dir, r)))}A${r.toFixed(
      2
    )},${r.toFixed(2)} 0 0 1 ${precise(
      Vec2.Add(pt.point.clone(), Vec2.Mul(dir, -r))
    )}Z`;
  }
  return d;
}

// ============================================================================
// Render props + bounds
// ============================================================================

export function getRenderableStrokeProps(stroke) {
  const isHL = stroke?.tool === 'highlighter';
  return {
    fill: stroke?.color ?? '#000000',
    stroke: 'none',
    strokeWidth: 0,
    opacity: stroke?.opacity ?? (isHL ? 0.35 : 1),
  };
}

export function getLineBounds(stroke) {
  const pts = stroke?.points;
  if (!pts || pts.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const p of pts) {
    const x = Array.isArray(p) ? p[0] : p.x,
      y = Array.isArray(p) ? p[1] : p.y;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}
