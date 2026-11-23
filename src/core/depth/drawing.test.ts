import { describe, expect, test } from "vitest";
import { defaultRecipe, type Brush, type DrawingLayer, type Stroke } from "../recipe.ts";
import { compositeDepth } from "./composite.ts";
import { rasteriseDrawing, strokeCost } from "./drawing.ts";
import type { LayerField } from "./raster.ts";

const HARD: Brush = { size: 0.2, softness: 0, mode: "set", value: 1 };

function stroke(points: number[], brush: Partial<Brush> = {}): Stroke {
  return { brush: { ...HARD, ...brush }, points };
}

function layer(strokes: Stroke[]): DrawingLayer {
  return {
    kind: "drawing",
    id: "drawing",
    name: "Drawing",
    visible: true,
    blend: "max",
    depth: 1,
    strokes,
  };
}

function field(strokes: Stroke[], width = 100, height = 100): LayerField {
  const target = {
    depth: new Float32Array(width * height),
    coverage: new Float32Array(width * height),
  };
  rasteriseDrawing(layer(strokes), { recipe: defaultRecipe(), width, height, target });
  return target;
}

const at = ({ depth }: LayerField, x: number, y: number, width = 100) => depth[y * width + x];
const coverageAt = ({ coverage }: LayerField, x: number, y: number, width = 100) =>
  coverage[y * width + x];

describe("rasteriseDrawing", () => {
  test("a single point paints a disc of the brush size", () => {
    const result = field([stroke([0.5, 0.5], { value: 0.6 })]);
    expect(at(result, 50, 50)).toBeCloseTo(0.6);
    expect(coverageAt(result, 50, 50)).toBe(1);
    // Radius 10 px: inside at 8 px, outside at 12 px.
    expect(coverageAt(result, 58, 50)).toBe(1);
    expect(coverageAt(result, 62, 50)).toBe(0);
    expect(at(result, 62, 50)).toBe(0);
  });

  test("points far apart are joined so fast strokes stay continuous", () => {
    const result = field([stroke([0.1, 0.5, 0.9, 0.5])]);
    for (let x = 10; x < 90; x++) {
      expect(coverageAt(result, x, 50)).toBe(1);
    }
  });

  test("sharp turns and reversals keep the rounded brush around the joint", () => {
    const vee = field([stroke([0.2, 0.2, 0.5, 0.5, 0.8, 0.2])]);
    expect(coverageAt(vee, 50, 58)).toBe(1);
    expect(coverageAt(vee, 50, 62)).toBe(0);
    const reversal = field([stroke([0.2, 0.5, 0.6, 0.5, 0.3, 0.5])]);
    expect(coverageAt(reversal, 68, 50)).toBe(1);
    expect(coverageAt(reversal, 72, 50)).toBe(0);
    expect(coverageAt(reversal, 12, 50)).toBe(1);
  });

  test("the brush size is a fraction of the canvas height at any resolution", () => {
    const small = field([stroke([0.5, 0.5])], 100, 100);
    const large = field([stroke([0.5, 0.5])], 400, 400);
    expect(coverageAt(small, 58, 50)).toBe(1);
    expect(coverageAt(large, 232, 200, 400)).toBe(1);
    expect(coverageAt(large, 248, 200, 400)).toBe(0);
  });

  test("softness makes the edge fall off gradually", () => {
    const hard = field([stroke([0.5, 0.5])]);
    const soft = field([stroke([0.5, 0.5], { softness: 1 })]);
    expect(coverageAt(soft, 50, 50)).toBeGreaterThan(0.95);
    expect(coverageAt(soft, 55, 50)).toBeGreaterThan(0.2);
    expect(coverageAt(soft, 55, 50)).toBeLessThan(coverageAt(hard, 55, 50));
    // Monotonic falloff from the middle.
    for (let x = 51; x < 62; x++) {
      expect(coverageAt(soft, x, 50)).toBeLessThanOrEqual(coverageAt(soft, x - 1, 50));
    }
  });

  test("set paints towards the value, replacing earlier strokes", () => {
    const result = field([stroke([0.5, 0.5], { value: 1 }), stroke([0.5, 0.5], { value: 0.25 })]);
    expect(at(result, 50, 50)).toBeCloseTo(0.25);
  });

  test("raise and lower accumulate and clamp", () => {
    const raise = stroke([0.5, 0.5], { mode: "raise", value: 0.4 });
    expect(at(field([raise, raise]), 50, 50)).toBeCloseTo(0.8);
    expect(at(field([raise, raise, raise]), 50, 50)).toBe(1);
    const lower = stroke([0.5, 0.5], { mode: "lower", value: 0.3 });
    expect(at(field([raise, raise, lower]), 50, 50)).toBeCloseTo(0.5);
    expect(at(field([raise, lower, lower]), 50, 50)).toBe(0);
  });

  test("a stroke crossing itself raises once", () => {
    const result = field([stroke([0.3, 0.5, 0.7, 0.5, 0.3, 0.5], { mode: "raise", value: 0.4 })]);
    expect(at(result, 50, 50)).toBeCloseTo(0.4);
  });

  test("lower only changes painted areas", () => {
    const result = field([stroke([0.5, 0.5], { mode: "lower", value: 1 })]);
    expect(coverageAt(result, 50, 50)).toBe(0);
  });

  test("smooth blurs the painted edge without changing flat areas", () => {
    const block = stroke([0.2, 0.5, 0.8, 0.5], { size: 0.6 });
    const sharp = field([block]);
    const smoothed = field([block, stroke([0.5, 0.2], { mode: "smooth", size: 0.3 })]);
    // The top edge of the block, at y = 20, passes through the smoothing brush.
    const edge = (result: LayerField) => [16, 18, 20, 22, 24].map((y) => coverageAt(result, 50, y));
    expect(edge(smoothed)).not.toEqual(edge(sharp));
    expect(coverageAt(smoothed, 50, 16)).toBeGreaterThan(coverageAt(sharp, 50, 16));
    expect(coverageAt(smoothed, 50, 24)).toBeLessThan(1);
    expect(at(smoothed, 50, 60)).toBe(1);
    expect(coverageAt(smoothed, 50, 60)).toBe(1);
  });

  test("strokes outside the canvas are clipped", () => {
    const result = field([stroke([-0.4, -0.4, 1.4, -0.4])]);
    expect(result.coverage.every((value) => value === 0)).toBe(true);
    const edge = field([stroke([0, 0])]);
    expect(coverageAt(edge, 0, 0)).toBe(1);
  });

  test("composites through the core registry", async () => {
    const recipe = { ...defaultRecipe(), layers: [layer([stroke([0.5, 0.5], { value: 0.5 })])] };
    const depth = await compositeDepth(recipe, 100, 100);
    expect(depth[50 * 100 + 50]).toBeCloseTo(0.5);
    expect(depth[0]).toBe(0);
  });
});

describe("strokeCost", () => {
  const square = (size: number) => Math.PI * (size / 2) ** 2;

  test("a dot costs its disc as a fraction of the canvas", () => {
    expect(strokeCost(stroke([0.5, 0.5], { size: 0.2 }), 2)).toBeCloseTo(square(0.2) / 2);
  });

  test("a line adds its length times the brush width, measured in canvas heights", () => {
    const line = stroke([0, 0.5, 1, 0.5], { size: 0.2 });
    expect(strokeCost(line, 2)).toBeCloseTo((0.2 * 2 + square(0.2)) / 2);
  });

  test("a joint adds the part of its disc that the turn uncovers", () => {
    const straight = stroke([0, 0.5, 0.5, 0.5, 1, 0.5], { size: 0.2 });
    const reversed = stroke([0, 0.5, 0.5, 0.5, 0, 0.5], { size: 0.2 });
    expect(strokeCost(straight, 1)).toBeCloseTo(0.2 + square(0.2));
    expect(strokeCost(reversed, 1)).toBeCloseTo(0.2 + 1.5 * square(0.2));
  });

  test("fine brushes still cost something per row", () => {
    expect(strokeCost(stroke([0, 0, 1, 1], { size: 0.001 }), 1)).toBeGreaterThan(0.02);
  });

  test("smoothing adds the area it blurs", () => {
    const line = stroke([0.25, 0.5, 0.75, 0.5], { size: 0.1 });
    const smooth = stroke(line.points, { size: 0.1, mode: "smooth" });
    expect(strokeCost(smooth, 1)).toBeGreaterThan(strokeCost(line, 1) + 0.5 * 0.2);
  });
});
