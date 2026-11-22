import { describe, expect, test } from "vitest";
import { parseRecipe, RECIPE_LIMITS } from "./parseRecipe.ts";
import { createRandom } from "./random.ts";
import { defaultRecipe, type DrawingLayer, type Stroke } from "./recipe.ts";
import { finishStroke, simplifyPoints, STROKE_GRID } from "./strokes.ts";

/** Distance in canvas heights from (x, y) to the nearest segment of `line`. */
function distanceToLine(line: number[], aspect: number, x: number, y: number): number {
  const ends = line.length === 2 ? [...line, ...line] : line;
  let best = Infinity;
  for (let i = 0; i + 3 < ends.length; i += 2) {
    const ax = ends[i] * aspect;
    const ay = ends[i + 1];
    const dx = ends[i + 2] * aspect - ax;
    const dy = ends[i + 3] - ay;
    const px = x * aspect - ax;
    const py = y - ay;
    const lengthSquared = dx * dx + dy * dy;
    const t = lengthSquared > 0 ? Math.min(1, Math.max(0, (px * dx + py * dy) / lengthSquared)) : 0;
    best = Math.min(best, Math.hypot(px - t * dx, py - t * dy));
  }
  return best;
}

/** A pointer wandering over the canvas, sampled at `rate` per second for `seconds`. */
function scribble(seed: number, seconds: number, rate: number): number[] {
  const random = createRandom(seed);
  const points: number[] = [];
  let x = 0.5;
  let y = 0.5;
  let heading = 0;
  for (let i = 0; i < seconds * rate; i++) {
    heading += (random.float() - 0.5) * 0.8;
    const speed = 0.4 + random.float() * 1.2;
    x = Math.min(1, Math.max(0, x + (Math.cos(heading) * speed) / rate));
    y = Math.min(1, Math.max(0, y + (Math.sin(heading) * speed) / rate));
    points.push(x, y);
  }
  return points;
}

describe("simplifyPoints", () => {
  test("keeps both ends and drops points on a straight line", () => {
    const line = [0, 0, 0.25, 0.25, 0.5, 0.5, 0.75, 0.75, 1, 1];
    expect(simplifyPoints(line, 1, 0.001)).toEqual([0, 0, 1, 1]);
    expect(simplifyPoints([0.3, 0.4], 1, 0.1)).toEqual([0.3, 0.4]);
  });

  test("keeps corners beyond the tolerance", () => {
    const corner = [0, 0, 0.5, 0.5, 1, 0];
    expect(simplifyPoints(corner, 1, 0.1)).toEqual(corner);
    expect(simplifyPoints(corner, 1, 0.6)).toEqual([0, 0, 1, 0]);
  });

  test("measures distance in canvas heights on wide canvases", () => {
    // 0.01 of the width is 0.02 canvas heights at aspect 2.
    const sideways = [0.5, 0, 0.51, 0.5, 0.5, 1];
    expect(simplifyPoints(sideways, 2, 0.015)).toHaveLength(6);
    expect(simplifyPoints(sideways, 0.5, 0.015)).toHaveLength(4);
  });

  test("every dropped point stays within the tolerance", () => {
    for (const aspect of [0.5, 1, 16 / 9]) {
      const raw = scribble(3, 2, 120);
      const tolerance = 0.004;
      const simplified = simplifyPoints(raw, aspect, tolerance);
      expect(simplified.length).toBeLessThan(raw.length / 2);
      for (let i = 0; i < raw.length; i += 2) {
        expect(distanceToLine(simplified, aspect, raw[i], raw[i + 1])).toBeLessThanOrEqual(
          tolerance + 1e-12,
        );
      }
    }
  });
});

describe("finishStroke", () => {
  test("stays within the tolerance plus rounding, on the grid", () => {
    const raw = scribble(5, 3, 120);
    const brushSize = 0.05;
    const finished = finishStroke(raw, 16 / 9, brushSize);
    const rounding = Math.hypot((16 / 9) * STROKE_GRID, STROKE_GRID) / 2;
    for (let i = 0; i < raw.length; i += 2) {
      expect(distanceToLine(finished, 16 / 9, raw[i], raw[i + 1])).toBeLessThanOrEqual(
        brushSize / 20 + rounding,
      );
    }
    for (const value of finished) {
      expect(Number.isInteger(value / STROKE_GRID)).toBe(true);
    }
  });

  test("drops repeated points and clamps to the recipe's position range", () => {
    expect(finishStroke([0.5, 0.5, 0.5, 0.5, 0.50001, 0.5], 1, 0.1)).toEqual([0.5, 0.5]);
    expect(finishStroke([-3, 0.5, 3, 0.5], 1, 0.1)).toEqual([-0.5, 0.5, 1.5, 0.5]);
  });

  test("simplifies more coarsely when a stroke has too many points", () => {
    const raw = Array.from({ length: 6000 }, (_, i) => [i / 6000, i % 2 === 0 ? 0.4 : 0.6]).flat();
    const finished = finishStroke(raw, 1, 0.001);
    expect(finished.length / 2).toBeLessThanOrEqual(RECIPE_LIMITS.pointsPerStroke);
  });

  test("a 30-second scribble session fits the recipe's point caps", () => {
    // A fast pen sampled at 240 Hz, lifted every two seconds.
    const strokes: Stroke[] = [];
    for (let s = 0; s < 15; s++) {
      const brush = { size: 0.01, softness: 0.5, mode: "set" as const, value: 1 };
      strokes.push({ brush, points: finishStroke(scribble(s, 2, 240), 16 / 9, brush.size) });
    }
    const total = strokes.reduce((sum, stroke) => sum + stroke.points.length / 2, 0);
    expect(total).toBeLessThan(RECIPE_LIMITS.pointsTotal / 10);
    const layer: DrawingLayer = {
      kind: "drawing",
      id: "drawing",
      name: "Drawing",
      visible: true,
      blend: "max",
      depth: 1,
      strokes,
    };
    const recipe = { ...defaultRecipe(), layers: [layer] };
    expect(parseRecipe(recipe)).toEqual(recipe);
  });
});
