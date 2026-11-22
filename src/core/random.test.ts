import { describe, expect, test } from "vitest";
import { createRandom, deriveSeed } from "./random.ts";

function take(seed: number, count: number): number[] {
  const random = createRandom(seed);
  return Array.from({ length: count }, () => random.float());
}

function correlation(xs: readonly number[], ys: readonly number[]): number {
  const n = xs.length;
  const mean = (values: readonly number[]) => values.reduce((sum, v) => sum + v, 0) / n;
  const mx = mean(xs);
  const my = mean(ys);
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = (xs[i] ?? 0) - mx;
    const dy = (ys[i] ?? 0) - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  return sxy / Math.sqrt(sxx * syy);
}

describe("createRandom", () => {
  test("produces the same fixed sequence for a seed on every platform", () => {
    const random = createRandom(1);
    expect(Array.from({ length: 5 }, () => random.uint32())).toEqual([
      4064752930, 1169703512, 1317941441, 2551256358, 1943867441,
    ]);
    const zero = createRandom(0);
    expect(Array.from({ length: 3 }, () => zero.uint32())).toEqual([
      4270301181, 3717780726, 2919608142,
    ]);
  });

  test("is deterministic per seed", () => {
    expect(take(123456789, 100)).toEqual(take(123456789, 100));
  });

  test("gives different sequences for neighbouring seeds", () => {
    expect(take(41, 8)).not.toEqual(take(42, 8));
    expect(Math.abs(correlation(take(41, 10_000), take(42, 10_000)))).toBeLessThan(0.05);
  });

  test("returns floats in [0, 1) with a uniform spread", () => {
    const values = take(0xffffffff, 20_000);
    expect(values.every((v) => v >= 0 && v < 1)).toBe(true);
    for (let bucket = 0; bucket < 10; bucket++) {
      const count = values.filter((v) => Math.floor(v * 10) === bucket).length;
      expect(count).toBeGreaterThan(1800);
      expect(count).toBeLessThan(2200);
    }
  });

  test("returns unsigned 32-bit integers", () => {
    const random = createRandom(7);
    for (let i = 0; i < 1000; i++) {
      const value = random.uint32();
      expect(Number.isInteger(value) && value >= 0 && value <= 0xffffffff).toBe(true);
    }
  });

  test.each([-1, 0.5, 2 ** 32, Number.NaN, Infinity])("rejects the seed %s", (seed) => {
    expect(() => createRandom(seed)).toThrow(RangeError);
  });
});

describe("deriveSeed", () => {
  test("is deterministic and fixed across platforms", () => {
    expect(deriveSeed(1, "texture")).toBe(989324038);
    expect(deriveSeed(1, "layer:a")).toBe(3130148835);
    expect(deriveSeed(0, "")).toBe(340428713);
  });

  test("returns unsigned 32-bit integers usable as seeds", () => {
    for (const label of ["", "a", "texture", "layer:🙂"]) {
      const seed = deriveSeed(0xffffffff, label);
      expect(Number.isInteger(seed) && seed >= 0 && seed <= 0xffffffff).toBe(true);
      expect(() => createRandom(seed)).not.toThrow();
    }
  });

  test("gives distinct seeds for distinct labels and parent seeds", () => {
    const seeds = new Set<number>();
    for (let parent = 0; parent < 10; parent++) {
      for (let i = 0; i < 1000; i++) {
        seeds.add(deriveSeed(parent, `layer:${String(i)}`));
      }
    }
    expect(seeds.size).toBe(10_000);
    expect(deriveSeed(5, "ab")).not.toBe(deriveSeed(5, "ba"));
    expect(deriveSeed(5, "a")).not.toBe(deriveSeed(5, "a\0"));
  });

  test("gives sub-streams that are uncorrelated with each other and the parent", () => {
    const parent = take(99, 10_000);
    const texture = take(deriveSeed(99, "texture"), 10_000);
    const layer = take(deriveSeed(99, "layer:1"), 10_000);
    const sibling = take(deriveSeed(99, "layer:2"), 10_000);
    for (const [xs, ys] of [
      [parent, texture],
      [parent, layer],
      [texture, layer],
      [layer, sibling],
    ] as const) {
      expect(Math.abs(correlation(xs, ys))).toBeLessThan(0.05);
    }
  });
});
