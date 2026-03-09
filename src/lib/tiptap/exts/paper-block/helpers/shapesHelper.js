// shapesHelper
export const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

function fitCircle(points) {
  const n = points.length;
  let sumX = 0,
    sumY = 0,
    sumX2 = 0,
    sumY2 = 0;
  let sumXY = 0,
    sumX3 = 0,
    sumY3 = 0,
    sumX1Y2 = 0,
    sumX2Y1 = 0;

  for (const [x, y] of points) {
    const x2 = x * x;
    const y2 = y * y;
    sumX += x;
    sumY += y;
    sumX2 += x2;
    sumY2 += y2;
    sumXY += x * y;
    sumX3 += x2 * x;
    sumY3 += y2 * y;
    sumX1Y2 += x * y2;
    sumX2Y1 += x2 * y;
  }

  const C = n * sumX2 - sumX * sumX;
  const D = n * sumXY - sumX * sumY;
  const E = n * (sumX3 + sumX1Y2) - (sumX2 + sumY2) * sumX;
  const G = n * sumY2 - sumY * sumY;
  const H = n * (sumX2Y1 + sumY3) - (sumX2 + sumY2) * sumY;

  const denominator = 2 * (C * G - D * D);
  if (Math.abs(denominator) < 1e-12) return null;

  const a = (E * G - D * H) / denominator;
  const b = (C * H - D * E) / denominator;

  const center = [a, b];

  const radius = Math.sqrt(
    (sumX2 + sumY2 - 2 * a * sumX - 2 * b * sumY) / n + a * a + b * b
  );

  return { center, radius };
}

export function isLine(points, tolerance = 5) {
  if (points.length < 2) return false;
  const [start, end] = [points[0], points[points.length - 1]];
  const len = distance(start, end);
  const maxDeviation = points.reduce((maxDev, point) => {
    const area = Math.abs(
      (end[0] - start[0]) * (start[1] - point[1]) -
        (start[0] - point[0]) * (end[1] - start[1])
    );
    const dist = area / len;
    return Math.max(maxDev, dist);
  }, 0);
  return maxDeviation < tolerance;
}

export function isCircle(points, tolerance = 10, closureTolerance = 20) {
  if (points.length < 5) return false;
  const circle = fitCircle(points);
  if (!circle) return false;

  const { center, radius } = circle;
  const distances = points.map((p) => distance(p, center));
  const variance =
    distances.reduce((sum, d) => sum + (d - radius) ** 2, 0) / distances.length;

  if (Math.sqrt(variance) > tolerance) return false;

  const startEndDist = distance(points[0], points[points.length - 1]);
  if (startEndDist > closureTolerance) return false;

  return true;
}

export function recognizeShape(points) {
  console.log('Recognizing shape for points:', points);
  if (isLine(points)) return 'line';
  if (isCircle(points)) return 'circle';
  return null;
}

export function createShape(shape, points, tool, nextId, getSettings) {
  const settings = getSettings();

  if (shape === 'line') {
    const [start, end] = [points[0], points[points.length - 1]];
    const numPoints = Math.max(points.length, 10);

    const interpolated = [];
    for (let i = 0; i < numPoints; i++) {
      const t = i / (numPoints - 1);
      interpolated.push([
        start[0] + t * (end[0] - start[0]),
        start[1] + t * (end[1] - start[1]),
      ]);
    }

    return {
      id: `line_${nextId}`,
      points: interpolated,
      tool,
      color: settings.color,
      size: settings.size,
    };
  }

  if (shape === 'circle') {
    const circle = fitCircle(points);
    if (!circle) return null;

    const { center, radius } = circle;
    const segments = 64;
    const circlePoints = [];

    for (let i = 0; i < segments; i++) {
      const angle = (2 * Math.PI * i) / segments;
      circlePoints.push([
        center[0] + radius * Math.cos(angle),
        center[1] + radius * Math.sin(angle),
      ]);
    }
    circlePoints.push(circlePoints[0]);

    return {
      id: `circle_${nextId}`,
      points: circlePoints,
      tool,
      color: settings.color,
      size: settings.size,
    };
  }

  return null;
}
