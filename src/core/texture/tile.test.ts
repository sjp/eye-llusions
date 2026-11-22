import { describe, expect, test } from "vitest";
import { createRandom } from "../random.ts";
import type { Asset } from "../recipe.ts";
import { FLAT_WARNING, fitTile, flatFraction } from "./tile.ts";

function rgba(width: number, height: number, pixel: (x: number, y: number) => number[]): Asset {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      data.set(pixel(x, y), (y * width + x) * 4);
    }
  }
  return { format: "rgba", width, height, data };
}

function gray(width: number, height: number, value: (x: number, y: number) => number): Asset {
  const data = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      data[y * width + x] = value(x, y);
    }
  }
  return { format: "gray", width, height, data };
}

/** Deterministic pseudo-random bytes. */
function noise(seed: number): (x: number, y: number) => number {
  const random = createRandom(seed);
  return () => random.uint32() & 0xff;
}

describe("fitTile", () => {
  test("resamples to the width, keeping the aspect", () => {
    const fitted = fitTile(
      gray(100, 50, () => 0),
      30,
    );
    expect([fitted.width, fitted.height]).toEqual([30, 15]);
    expect(fitted.colours).toHaveLength(30 * 15);
  });

  test("averages the area each pixel covers when shrinking", () => {
    // Alternating black and white columns average to mid grey.
    const stripes = rgba(8, 2, (x) => (x % 2 === 0 ? [0, 0, 0, 255] : [255, 255, 255, 255]));
    expect([...fitTile(stripes, 4).colours]).toEqual(Array.from({ length: 4 }, () => 0x808080ff));
    // Three source columns into two: the middle one is split between them.
    const steps = rgba(3, 1, (x) => [x * 90, 0, 0, 255]);
    expect([...fitTile(steps, 2).colours].map((colour) => colour >>> 24)).toEqual([30, 150]);
  });

  test("keeps colours and repeats pixels when enlarging", () => {
    const pair = rgba(2, 1, (x) => (x === 0 ? [255, 0, 0, 255] : [0, 0, 255, 255]));
    const fitted = fitTile(pair, 4);
    expect([fitted.width, fitted.height]).toEqual([4, 2]);
    expect(Array.from(fitted.colours.subarray(0, 4))).toEqual([
      0xff0000ff, 0xff0000ff, 0x0000ffff, 0x0000ffff,
    ]);
  });

  test("makes only the rows asked for", () => {
    const tall = gray(1, 2048, (_, y) => y % 256);
    const fitted = fitTile(tall, 500, 40);
    expect([fitted.width, fitted.height]).toEqual([500, 40]);
  });
});

describe("flatFraction", () => {
  test("is near zero for a detailed tile", () => {
    expect(flatFraction(gray(64, 64, noise(1)))).toBeLessThan(0.05);
  });

  test("is one for a single colour", () => {
    expect(flatFraction(rgba(40, 30, () => [200, 120, 40, 255]))).toBe(1);
  });

  test("measures the share of a tile that is flat", () => {
    const random = noise(2);
    // The left half is a flat sky, the right half detailed.
    const half = gray(64, 64, (x, y) => (x < 32 ? 180 : random(x, y)));
    expect(flatFraction(half)).toBeCloseTo(0.5, 1);
    expect(flatFraction(half)).toBeGreaterThan(FLAT_WARNING);
  });

  test("counts a gentle gradient as flat", () => {
    expect(flatFraction(gray(64, 64, (x) => 100 + Math.floor(x / 16)))).toBe(1);
  });
});
