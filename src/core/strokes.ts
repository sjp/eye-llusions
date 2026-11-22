import { RECIPE_LIMITS } from "./parseRecipe.ts";

/** Stroke coordinates are rounded to multiples of this. */
export const STROKE_GRID = 1 / 4096;

/** Simplification tolerance as a fraction of the brush size. */
const TOLERANCE_PER_SIZE = 1 / 20;

/** Squared distance, in canvas heights, from point `p` to segment `a`–`b` of `points`. */
function distanceSquared(points: number[], aspect: number, p: number, a: number, b: number) {
  const ax = points[2 * a] * aspect;
  const ay = points[2 * a + 1];
  const dx = points[2 * b] * aspect - ax;
  const dy = points[2 * b + 1] - ay;
  const px = points[2 * p] * aspect - ax;
  const py = points[2 * p + 1] - ay;
  const lengthSquared = dx * dx + dy * dy;
  let t = lengthSquared > 0 ? (px * dx + py * dy) / lengthSquared : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const ex = px - t * dx;
  const ey = py - t * dy;
  return ex * ex + ey * ey;
}

/**
 * Ramer–Douglas–Peucker reduction of flattened `x, y` points in normalised canvas
 * coordinates on a canvas `aspect` times wider than it is tall. Every dropped point lies
 * within `tolerance` canvas heights of the simplified line. The ends are always kept.
 */
export function simplifyPoints(
  points: readonly number[],
  aspect: number,
  tolerance: number,
): number[] {
  const count = points.length / 2;
  if (count <= 2) {
    return [...points];
  }
  const source = [...points];
  const keep = new Uint8Array(count);
  keep[0] = 1;
  keep[count - 1] = 1;
  const limit = tolerance * tolerance;
  const stack: [number, number][] = [[0, count - 1]];
  for (let span = stack.pop(); span !== undefined; span = stack.pop()) {
    const [a, b] = span;
    let worst = -1;
    let worstDistance = limit;
    for (let p = a + 1; p < b; p++) {
      const distance = distanceSquared(source, aspect, p, a, b);
      if (distance > worstDistance) {
        worst = p;
        worstDistance = distance;
      }
    }
    if (worst >= 0) {
      keep[worst] = 1;
      stack.push([a, worst], [worst, b]);
    }
  }
  const out: number[] = [];
  for (let p = 0; p < count; p++) {
    if (keep[p] === 1) {
      out.push(source[2 * p], source[2 * p + 1]);
    }
  }
  return out;
}

const [MIN_POSITION, MAX_POSITION] = [-0.5, 1.5];

function quantise(value: number): number {
  const clamped = Math.min(MAX_POSITION, Math.max(MIN_POSITION, value));
  return Math.round(clamped / STROKE_GRID) * STROKE_GRID;
}

/**
 * Prepares a finished stroke's raw points for the recipe: simplified to within a
 * twentieth of the brush size, rounded to `STROKE_GRID`, with repeated points dropped,
 * and, if still too long for a stroke, simplified more coarsely until it fits.
 */
export function finishStroke(
  points: readonly number[],
  aspect: number,
  brushSize: number,
): number[] {
  let tolerance = Math.max(STROKE_GRID, brushSize * TOLERANCE_PER_SIZE);
  for (;;) {
    const simplified = simplifyPoints(points, aspect, tolerance);
    const out: number[] = [];
    for (let i = 0; i < simplified.length; i += 2) {
      const x = quantise(simplified[i]);
      const y = quantise(simplified[i + 1]);
      if (out.length === 0 || out.at(-2) !== x || out.at(-1) !== y) {
        out.push(x, y);
      }
    }
    if (out.length / 2 <= RECIPE_LIMITS.pointsPerStroke) {
      return out;
    }
    tolerance *= 2;
  }
}
