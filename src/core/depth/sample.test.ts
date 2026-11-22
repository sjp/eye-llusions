import { describe, expect, test } from "vitest";
import { defaultRecipe, type SampleLayer, type SampleShape } from "../recipe.ts";
import { compositeDepth } from "./composite.ts";

const SHAPES: SampleShape[] = [
  { type: "sphere" },
  { type: "ripples", rings: 4 },
  { type: "pyramid", sides: 4 },
  { type: "torus", thickness: 0.4 },
  { type: "spiralStairs", steps: 12, turns: 2 },
];

function layer(shape: SampleShape, overrides: Partial<SampleLayer> = {}): SampleLayer {
  return {
    kind: "sample",
    id: "shape",
    name: "Shape",
    visible: true,
    blend: "max",
    depth: 1,
    shape,
    center: { x: 0.5, y: 0.5 },
    size: 0.8,
    ...overrides,
  };
}

async function render(layers: SampleLayer[], width: number, height: number): Promise<Float32Array> {
  return compositeDepth({ ...defaultRecipe(), layers }, width, height);
}

/** Depth along the row through the canvas centre, from the centre to the right edge. */
function radial(depth: Float32Array, width: number, height: number): number[] {
  const row = Math.floor(height / 2) * width;
  return Array.from(depth.subarray(row + width / 2, row + width));
}

function downsample(depth: Float32Array, width: number, height: number): Float32Array {
  const out = new Float32Array((width / 2) * (height / 2));
  for (let y = 0; y < height / 2; y++) {
    for (let x = 0; x < width / 2; x++) {
      const i = 2 * y * width + 2 * x;
      out[y * (width / 2) + x] =
        (depth[i] + depth[i + 1] + depth[i + width] + depth[i + width + 1]) / 4;
    }
  }
  return out;
}

describe("default recipe", () => {
  test("is a centred sphere", async () => {
    const width = 320;
    const height = 180;
    const depth = await compositeDepth(defaultRecipe(), width, height);
    const at = (x: number, y: number) => depth[y * width + x];
    expect(at(160, 90)).toBeCloseTo(1, 2);
    expect(at(0, 0)).toBe(0);
    expect(at(319, 179)).toBe(0);
    // Radius 0.3 canvas heights: 54 pixels.
    expect(at(160 + 52, 90)).toBeGreaterThan(0);
    expect(at(160 + 52, 90)).toBeLessThan(0.3);
    expect(at(160 + 56, 90)).toBe(0);
    expect(at(160 - 30, 90)).toBeCloseTo(at(160 + 29, 90), 5);
    expect(at(160, 90 - 30)).toBeCloseTo(at(160, 90 + 29), 5);
  });
});

describe("sample shapes", () => {
  test.each(SHAPES)("$type stays in [0, 1] and is flat outside its disc", async (shape) => {
    const depth = await render([layer(shape)], 200, 100);
    for (const value of depth) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
    for (let y = 0; y < 100; y++) {
      expect(depth[y * 200 + 50]).toBe(0);
      expect(depth[y * 200 + 150]).toBe(0);
    }
  });

  test.each([
    [{ type: "sphere" }, 1],
    [{ type: "ripples", rings: 4 }, 1],
    [{ type: "pyramid", sides: 4 }, 1],
    [{ type: "torus", thickness: 0.4 }, 0],
    [{ type: "spiralStairs", steps: 12, turns: 2 }, 1],
  ] satisfies [SampleShape, number][])("$0.type centre height", async (shape, centre) => {
    const depth = await render([layer(shape, { size: 0.5 })], 401, 401);
    expect(depth[200 * 401 + 200]).toBeCloseTo(centre, 2);
    const scaled = await render([layer(shape, { size: 0.5, depth: 0.4 })], 401, 401);
    expect(scaled[200 * 401 + 200]).toBeCloseTo(centre * 0.4, 2);
  });

  test("sphere falls to zero at its rim", async () => {
    const profile = radial(await render([layer({ type: "sphere" })], 400, 200), 400, 200);
    // Radius 80 pixels.
    expect(profile[0]).toBeCloseTo(1, 3);
    expect(profile[40]).toBeCloseTo(Math.sqrt(1 - (40.5 / 80) ** 2), 3);
    expect(profile[79]).toBeLessThan(0.2);
    expect(profile[81]).toBe(0);
    for (let i = 1; i < 80; i++) {
      expect(profile[i]).toBeLessThan(profile[i - 1]);
    }
  });

  test("ripples have one crest per ring", async () => {
    const profile = radial(
      await render([layer({ type: "ripples", rings: 5 })], 800, 400),
      800,
      400,
    );
    const crests = profile.filter(
      (value, i) => i > 0 && value > profile[i - 1] && value >= (profile.at(i + 1) ?? 0),
    );
    expect(crests).toHaveLength(4);
    expect(profile[0]).toBeGreaterThan(crests[0]);
  });

  test("pyramid has straight edges with a vertex pointing up", async () => {
    const size = 401;
    const depth = await render([layer({ type: "pyramid", sides: 4 }, { size: 1 })], size, size);
    const at = (x: number, y: number) => depth[y * size + x];
    // Towards a vertex the slope is gentler than towards the middle of a side.
    expect(at(200, 100)).toBeCloseTo(0.5, 2);
    expect(at(150, 150)).toBeCloseTo(1 - (50 * Math.SQRT2) / 200 / Math.SQRT1_2, 2);
    expect(at(200, 2)).toBeGreaterThan(0);
    expect(at(60, 60)).toBe(0);
  });

  test("torus peaks along its ring with a hole in the middle", async () => {
    const shape: SampleShape = { type: "torus", thickness: 0.4 };
    const profile = radial(await render([layer(shape)], 400, 200), 400, 200);
    // Radius 80 pixels; the tube spans 48 to 80 with its crest at 64.
    expect(profile[30]).toBe(0);
    expect(profile[64]).toBeCloseTo(1, 2);
    expect(profile[56]).toBeCloseTo(profile[71], 2);
    expect(profile[82]).toBe(0);
  });

  test("torus leaves its hole uncovered", async () => {
    const shape: SampleShape = { type: "torus", thickness: 0.4 };
    const flat = layer({ type: "sphere" }, { size: 4, depth: 0.5 });
    const depth = await render([flat, layer(shape, { blend: "replace" })], 400, 200);
    expect(depth[100 * 400 + 200]).toBeCloseTo(0.5, 5);
  });

  test("spiral stairs have one level per step", async () => {
    const steps = 12;
    const depth = await render(
      [layer({ type: "spiralStairs", steps, turns: 2 }, { size: 1 })],
      300,
      300,
    );
    const levels = new Set<number>();
    for (let y = 0; y < 300; y++) {
      for (let x = 0; x < 300; x++) {
        const r = Math.hypot(x + 0.5 - 150, y + 0.5 - 150);
        if (r < 145) {
          levels.add(Math.round(depth[y * 300 + x] * steps));
        }
      }
    }
    expect([...levels].toSorted((a, b) => a - b)).toEqual(
      Array.from({ length: steps }, (_, i) => i + 1),
    );
  });

  test("anti-aliases the rim", async () => {
    const back = layer({ type: "sphere" }, { size: 4, depth: 0.5 });
    const front = layer({ type: "pyramid", sides: 4 }, { blend: "replace", depth: 0 });
    const values = new Set(await render([back, front], 400, 200));
    const between = [...values].filter((value) => value > 0.01 && value < 0.49);
    expect(between.length).toBeGreaterThan(10);
  });

  test("clips shapes that leave the canvas", async () => {
    const depth = await render(
      [layer({ type: "sphere" }, { center: { x: 1.1, y: -0.1 } })],
      100,
      50,
    );
    expect(depth[99]).toBeGreaterThan(0);
  });

  test.each(SHAPES)("$type is consistent across resolutions", async (shape) => {
    const layers = [layer(shape, { center: { x: 0.45, y: 0.55 }, size: 0.7 })];
    const coarse = await render(layers, 240, 135);
    const fine = downsample(await render(layers, 480, 270), 480, 270);
    let total = 0;
    for (let i = 0; i < coarse.length; i++) {
      total += Math.abs(coarse[i] - fine[i]);
    }
    expect(total / coarse.length).toBeLessThan(0.005);
  });
});
