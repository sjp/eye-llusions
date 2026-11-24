import { describe, expect, test } from "vitest";
import { createRandom } from "../random.ts";
import type { ValueFunction } from "./context.ts";
import { createGenerator, type ValueGenerator } from "./generators.ts";
import { FEATURE_CELLS } from "./scale.ts";

const WIDTH = 200;
const HEIGHT = 50;

function generate(generator: ValueGenerator, seed: number, cellSize = 1): ValueFunction {
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

/** Generators whose value is constant across each cell. */
const CELL_GENERATORS: ValueGenerator[] = [
  { type: "randomDots", density: 0.5 },
  { type: "colourNoise" },
];

const GENERATORS: ValueGenerator[] = [
  ...CELL_GENERATORS,
  { type: "fractalNoise", octaves: 4 },
  { type: "cells", shading: 0.5 },
  { type: "scatteredShapes", density: 0.8 },
];

/**
 * Pearson correlation between values `lag` pixels apart along rows, averaged over the
 * rows of the sample, as `[lag, correlation]` for each lag from `from` to `to`.
 */
function autocorrelations(rows: readonly number[][], from: number, to: number): [number, number][] {
  const all = rows.flat();
  const average = mean(all);
  const variance = mean(all.map((value) => (value - average) ** 2));
  const result: [number, number][] = [];
  for (let lag = from; lag <= to; lag++) {
    let sum = 0;
    let count = 0;
    for (const row of rows) {
      for (let x = 0; x + lag < row.length; x++) {
        sum += (row[x] - average) * (row[x + lag] - average);
        count += 1;
      }
    }
    result.push([lag, sum / count / variance]);
  }
  return result;
}

describe.each(GENERATORS)("$type", (generator) => {
  test("doesn't repeat within a strip width", () => {
    const cellSize = 2;
    const strip = 480;
    const values = createGenerator(generator, {
      random: createRandom(12),
      width: 2000,
      height: 400,
      cellSize,
    });
    const rows = Array.from({ length: 40 }, (_unused, row) =>
      Array.from({ length: 2 * strip }, (_, x) => values(x, row * 9)),
    );
    // Neighbouring pixels within a feature are alike; beyond two features they aren't.
    const feature = FEATURE_CELLS[generator.type] * cellSize;
    const correlated = autocorrelations(rows, 2 * feature, strip).filter(
      ([, correlation]) => Math.abs(correlation) >= 0.1,
    );
    expect(correlated).toEqual([]);
  });

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

  test("varies between cells in both directions", () => {
    const values = generate(generator, 9, 2);
    const row = Array.from({ length: 50 }, (_, i) => values(i * 2, 0));
    const column = Array.from({ length: 25 }, (_, i) => values(0, i * 2));
    expect(new Set(row).size).toBeGreaterThan(1);
    expect(new Set(column).size).toBeGreaterThan(1);
  });
});

describe.each(CELL_GENERATORS)("$type", (generator) => {
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

/** The fraction of values in each fifth of 0 to 1. */
function fifths(values: readonly number[]): number[] {
  const counts = [0, 0, 0, 0, 0];
  for (const value of values) {
    counts[Math.min(4, Math.floor(value * 5))] += 1;
  }
  return counts.map((count) => count / values.length);
}

/** The mean difference between horizontally adjacent pixels. */
function roughness(values: ValueFunction): number {
  let sum = 0;
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x + 1 < WIDTH; x++) {
      sum += Math.abs(values(x + 1, y) - values(x, y));
    }
  }
  return sum / (HEIGHT * (WIDTH - 1));
}

describe("fractalNoise", () => {
  test.each([1, 3, 6])("spreads %i octaves evenly over 0 to 1", (octaves) => {
    const noise = generate({ type: "fractalNoise", octaves }, 6);
    const values = Array.from({ length: 300 * 300 }, (_, i) => noise(i % 300, Math.floor(i / 300)));
    for (const share of fifths(values)) {
      expect(share).toBeGreaterThan(0.14);
      expect(share).toBeLessThan(0.26);
    }
  });

  test("changes smoothly between pixels", () => {
    expect(roughness(generate({ type: "fractalNoise", octaves: 1 }, 2, 4))).toBeLessThan(0.05);
  });

  test("gains fine detail with more octaves", () => {
    const smooth = roughness(generate({ type: "fractalNoise", octaves: 1 }, 2, 4));
    const detailed = roughness(generate({ type: "fractalNoise", octaves: 5 }, 2, 4));
    expect(detailed).toBeGreaterThan(smooth * 2);
  });

  test("varies continuously between pixels when oversampled", () => {
    const values = generate({ type: "fractalNoise", octaves: 2 }, 3, 4);
    expect(values(10.25, 5)).not.toBe(values(10, 5));
  });
});

describe("cells", () => {
  test("gives each cell one flat value without shading", () => {
    const values = grid(generate({ type: "cells", shading: 0 }, 4, 2));
    // About one cell per 10 x 10 pixel square.
    expect(new Set(values).size).toBeLessThan((WIDTH * HEIGHT) / 50);
    expect(new Set(values).size).toBeGreaterThan((WIDTH * HEIGHT) / 400);
  });

  test("darkens towards the borders with shading", () => {
    const flat = mean(grid(generate({ type: "cells", shading: 0 }, 4, 2)));
    const shaded = mean(grid(generate({ type: "cells", shading: 1 }, 4, 2)));
    expect(shaded).toBeLessThan(flat * 0.85);
    expect(new Set(grid(generate({ type: "cells", shading: 1 }, 4, 2))).size).toBeGreaterThan(
      new Set(grid(generate({ type: "cells", shading: 0 }, 4, 2))).size * 4,
    );
  });
});

describe("scatteredShapes", () => {
  const isGlyph = (value: number) => value <= 0.2 || value >= 0.8;

  test("shows only the background in the middle range at density 0", () => {
    for (const value of grid(generate({ type: "scatteredShapes", density: 0 }, 5, 2))) {
      expect(value).toBeGreaterThanOrEqual(0.3);
      expect(value).toBeLessThanOrEqual(0.7);
    }
  });

  test("covers more of the image at higher density", () => {
    const coverage = (density: number) =>
      mean(
        grid(generate({ type: "scatteredShapes", density }, 5, 2)).map((v) => (isGlyph(v) ? 1 : 0)),
      );
    expect(coverage(0.3)).toBeGreaterThan(0.05);
    expect(coverage(1)).toBeGreaterThan(coverage(0.3) * 2);
  });

  test("draws both dark and light glyphs", () => {
    const values = grid(generate({ type: "scatteredShapes", density: 1 }, 5, 2));
    expect(values.filter((v) => v <= 0.2).length).toBeGreaterThan(values.length / 20);
    expect(values.filter((v) => v >= 0.8).length).toBeGreaterThan(values.length / 20);
  });
});
