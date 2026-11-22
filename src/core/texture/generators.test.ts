import { describe, expect, test } from "vitest";
import { createRandom } from "../random.ts";
import type { TextureGenerator } from "../recipe.ts";
import { createGenerator, type ValueFunction } from "./generators.ts";

const WIDTH = 200;
const HEIGHT = 50;

function generate(generator: TextureGenerator, seed: number, cellSize = 1): ValueFunction {
  return createGenerator(generator, {
    random: createRandom(seed),
    width: WIDTH,
    height: HEIGHT,
    cellSize,
  });
}

function grid(values: ValueFunction, cellSize = 1): number[] {
  const result: number[] = [];
  for (let y = 0; y < HEIGHT; y += cellSize) {
    for (let x = 0; x < WIDTH; x += cellSize) {
      result.push(values(x, y));
    }
  }
  return result;
}

const mean = (values: readonly number[]) => values.reduce((sum, v) => sum + v, 0) / values.length;

const GENERATORS: TextureGenerator[] = [
  { type: "randomDots", density: 0.5 },
  { type: "colourNoise" },
];

describe.each(GENERATORS)("$type", (generator) => {
  test("is deterministic per seed", () => {
    expect(grid(generate(generator, 42))).toEqual(grid(generate(generator, 42)));
  });

  test("changes with the seed", () => {
    expect(grid(generate(generator, 42))).not.toEqual(grid(generate(generator, 43)));
  });

  test("doesn't depend on the order pixels are sampled in", () => {
    const forwards = generate(generator, 7);
    const backwards = generate(generator, 7);
    const reversed = Array.from({ length: WIDTH }, (_, i) => backwards(WIDTH - 1 - i, 3));
    expect(Array.from({ length: WIDTH }, (_, x) => forwards(x, 3))).toEqual(reversed.toReversed());
  });

  test("produces values from 0 to 1", () => {
    for (const value of grid(generate(generator, 1))) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
  });

  test("is constant within a cell", () => {
    const values = generate(generator, 5, 4);
    for (let cell = 0; cell < 20; cell++) {
      const base = values(cell * 4, 8);
      for (const [dx, dy] of [
        [1.5, 0],
        [3.75, 3],
        [0, 2],
      ] as const) {
        expect(values(cell * 4 + dx, 8 + dy)).toBe(base);
      }
    }
  });

  test("varies between cells in both directions", () => {
    const values = generate(generator, 9, 2);
    const row = Array.from({ length: 50 }, (_, i) => values(i * 2, 0));
    const column = Array.from({ length: 25 }, (_, i) => values(0, i * 2));
    expect(new Set(row).size).toBeGreaterThan(1);
    expect(new Set(column).size).toBeGreaterThan(1);
  });

  test("doesn't repeat along a row", () => {
    const values = generate(generator, 11);
    const row = Array.from({ length: 1000 }, (_, x) => values(x, 0));
    for (let period = 1; period <= 500; period++) {
      const matches = row.slice(period).filter((value, i) => value === row[i]).length;
      expect(matches / (row.length - period)).toBeLessThan(
        generator.type === "randomDots" ? 0.7 : 0.05,
      );
    }
  });
});

describe("randomDots", () => {
  test("is two-tone", () => {
    expect(new Set(grid(generate({ type: "randomDots", density: 0.3 }, 3)))).toEqual(
      new Set([0, 1]),
    );
  });

  test.each([0.1, 0.5, 0.9])("sets about a %f fraction of cells", (density) => {
    expect(mean(grid(generate({ type: "randomDots", density }, 4)))).toBeCloseTo(density, 1);
  });

  test("is all 0 at density 0 and all 1 at density 1", () => {
    expect(new Set(grid(generate({ type: "randomDots", density: 0 }, 4)))).toEqual(new Set([0]));
    expect(new Set(grid(generate({ type: "randomDots", density: 1 }, 4)))).toEqual(new Set([1]));
  });
});

describe("colourNoise", () => {
  test("is spread evenly over 0 to 1", () => {
    const values = grid(generate({ type: "colourNoise" }, 6));
    expect(mean(values)).toBeCloseTo(0.5, 1);
    const quarters = [0, 0, 0, 0];
    for (const value of values) {
      quarters[Math.floor(value * 4)] += 1;
    }
    for (const count of quarters) {
      expect(count / values.length).toBeCloseTo(0.25, 1);
    }
  });
});
