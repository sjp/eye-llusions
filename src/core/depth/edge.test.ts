import { describe, expect, test } from "vitest";
import { edgeDepth } from "./edge.ts";

/** A filled rectangle with a 2-pixel empty margin, padded to `width × height`. */
function rectangle(width: number, height: number): Float32Array {
  const coverage = new Float32Array(width * height);
  for (let y = 2; y < height - 2; y++) {
    coverage.fill(1, y * width + 2, y * width + width - 2);
  }
  return coverage;
}

/** Brute-force distance from a pixel to the nearest uncovered pixel. */
function bruteDistance(coverage: Float32Array, width: number, index: number): number {
  const x = index % width;
  const y = Math.floor(index / width);
  let best = Infinity;
  for (let i = 0; i < coverage.length; i++) {
    if (coverage[i] < 0.5) {
      const dx = (i % width) - x;
      const dy = Math.floor(i / width) - y;
      best = Math.min(best, Math.hypot(dx, dy));
    }
  }
  return best;
}

describe("edgeDepth", () => {
  const width = 40;
  const height = 24;
  const coverage = rectangle(width, height);
  const row = (depth: Float32Array, y: number) =>
    Array.from(depth.subarray(y * width, y * width + width));

  test("flat raises everything covered to full depth", () => {
    const depth = new Float32Array(width * height);
    edgeDepth(coverage, width, height, "flat", 8, depth);
    expect(row(depth, 12).slice(0, 4)).toEqual([0, 0, 1, 1]);
    expect(depth[12 * width + 20]).toBe(1);
  });

  test("bevel rises linearly over the edge width", () => {
    const depth = new Float32Array(width * height);
    edgeDepth(coverage, width, height, "bevel", 4, depth);
    const values = row(depth, 12).slice(2, 8);
    expect(values.map((value) => Math.round(value * 1000) / 1000)).toEqual([
      0.125, 0.375, 0.625, 0.875, 1, 1,
    ]);
  });

  test("round rises faster than bevel and meets it at both ends", () => {
    const bevel = new Float32Array(width * height);
    const round = new Float32Array(width * height);
    edgeDepth(coverage, width, height, "bevel", 6, bevel);
    edgeDepth(coverage, width, height, "round", 6, round);
    for (let x = 2; x < 6; x++) {
      expect(round[12 * width + x]).toBeGreaterThan(bevel[12 * width + x]);
    }
    expect(round[12 * width + 20]).toBe(1);
    expect(round[0]).toBe(0);
  });

  test("measures exact Euclidean distances to irregular outlines", () => {
    const blob = new Float32Array(width * height);
    for (let i = 0; i < blob.length; i++) {
      const x = i % width;
      const y = Math.floor(i / width);
      const inCircle = (x - 14) ** 2 + (y - 12) ** 2 < 81;
      const inBar = x >= 18 && x < 36 && y >= 6 && y < 16 && !(x === 30 && y === 10);
      blob[i] = inCircle || inBar ? 1 : 0;
    }
    const depth = new Float32Array(width * height);
    const edge = 50;
    edgeDepth(blob, width, height, "bevel", edge, depth);
    for (let i = 0; i < blob.length; i++) {
      const expected = blob[i] >= 0.5 ? (bruteDistance(blob, width, i) - 0.5) / edge : 0;
      expect(depth[i]).toBeCloseTo(expected, 5);
    }
  });

  test("an edge width of zero is flat", () => {
    const flat = new Float32Array(width * height);
    const bevel = new Float32Array(width * height);
    edgeDepth(coverage, width, height, "flat", 0, flat);
    edgeDepth(coverage, width, height, "bevel", 0, bevel);
    expect(bevel).toEqual(flat);
  });
});
