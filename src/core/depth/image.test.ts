import { describe, expect, test } from "vitest";
import { defaultRecipe, type Asset, type ImageLayer } from "../recipe.ts";
import { compositeDepth } from "./composite.ts";
import {
  applyLevels,
  blurField,
  downscaleSize,
  fitRect,
  invertDepth,
  luminance,
  posterizeDepth,
  sampleImage,
  thresholdDepth,
} from "./image.ts";

function field(width: number, height: number) {
  return {
    depth: new Float32Array(width * height),
    coverage: new Float32Array(width * height),
  };
}

function layer(overrides: Partial<ImageLayer> = {}): ImageLayer {
  return {
    kind: "image",
    id: "image",
    name: "Image",
    visible: true,
    blend: "max",
    depth: 1,
    asset: "picture",
    fit: "stretch",
    invert: false,
    levels: { black: 0, white: 1 },
    blur: 0,
    posterize: null,
    threshold: null,
    ...overrides,
  };
}

/** A horizontal ramp from 0 to 255. */
function ramp(width: number, height: number): Asset {
  const data = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      data[y * width + x] = Math.round((x / (width - 1)) * 255);
    }
  }
  return { format: "gray", width, height, data };
}

describe("luminance", () => {
  test("weights channels by Rec. 709 luma", () => {
    const rgba = new Uint8Array([
      255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255,
    ]);
    expect([...luminance(rgba)]).toEqual([54, 182, 18, 255]);
  });

  test("composites over black", () => {
    expect([...luminance(new Uint8Array([255, 255, 255, 0, 255, 255, 255, 128]))]).toEqual([
      0, 128,
    ]);
  });
});

describe("downscaleSize", () => {
  test("bounds the longest side and keeps the aspect", () => {
    expect(downscaleSize(4000, 3000, 1024)).toEqual({ width: 1024, height: 768 });
    expect(downscaleSize(300, 6000, 1024)).toEqual({ width: 51, height: 1024 });
  });

  test("never enlarges or collapses", () => {
    expect(downscaleSize(200, 100, 1024)).toEqual({ width: 200, height: 100 });
    expect(downscaleSize(5000, 1, 1024)).toEqual({ width: 1024, height: 1 });
  });
});

describe("fitRect", () => {
  test("contain letterboxes a wide image on a square canvas", () => {
    expect(fitRect("contain", 2, 100, 100)).toEqual({ left: 0, top: 25, width: 100, height: 50 });
  });

  test("cover crops a wide image on a square canvas", () => {
    expect(fitRect("cover", 2, 100, 100)).toEqual({ left: -50, top: 0, width: 200, height: 100 });
  });

  test("contain pillarboxes a tall image", () => {
    expect(fitRect("contain", 0.5, 100, 100)).toEqual({ left: 25, top: 0, width: 50, height: 100 });
  });

  test("stretch fills the canvas", () => {
    expect(fitRect("stretch", 3, 80, 40)).toEqual({ left: 0, top: 0, width: 80, height: 40 });
  });
});

describe("sampleImage", () => {
  test("interpolates bilinearly between pixels", () => {
    const gray = new Uint8Array([0, 255]);
    const target = field(4, 1);
    sampleImage(gray, 2, 1, { left: 0, top: 0, width: 4, height: 1 }, 4, 1, target);
    expect([...target.depth].map((v) => Math.round(v * 255))).toEqual([0, 64, 191, 255]);
    expect([...target.coverage]).toEqual([1, 1, 1, 1]);
  });

  test("leaves pixels outside the image uncovered and anti-aliases edges", () => {
    const gray = new Uint8Array([255]);
    const target = field(4, 1);
    sampleImage(gray, 1, 1, { left: 0.5, top: 0, width: 2, height: 1 }, 4, 1, target);
    expect([...target.coverage]).toEqual([0.5, 1, 0.5, 0]);
    expect(target.depth[3]).toBe(0);
  });
});

test("applyLevels maps black and white points to 0 and 1", () => {
  const depth = new Float32Array([0.1, 0.25, 0.5, 0.75, 0.9]);
  applyLevels(depth, 0.25, 0.75);
  expect([...depth]).toEqual([0, 0, 0.5, 1, 1]);
});

test("invertDepth flips near and far", () => {
  const depth = new Float32Array([0, 0.25, 1]);
  invertDepth(depth);
  expect([...depth]).toEqual([1, 0.75, 0]);
});

describe("blurField", () => {
  test("spreads a step and keeps flat areas flat", () => {
    const width = 40;
    const target = field(width, 1);
    target.coverage.fill(1);
    target.depth.fill(1, 20);
    blurField(target, width, 1, 9);
    expect(target.depth[0]).toBe(0);
    expect(target.depth[39]).toBe(1);
    expect(target.depth[19]).toBeGreaterThan(0.2);
    expect(target.depth[20]).toBeLessThan(0.8);
    for (let x = 1; x < width; x++) {
      expect(target.depth[x]).toBeGreaterThanOrEqual(target.depth[x - 1]);
    }
    expect([...target.coverage].every((c) => Math.abs(c - 1) < 1e-6)).toBe(true);
  });

  test("doesn't darken a covered area next to uncovered pixels", () => {
    const target = field(30, 1);
    target.depth.fill(0.8, 10);
    target.coverage.fill(1, 10);
    blurField(target, 30, 1, 6);
    expect(target.depth[10]).toBeCloseTo(0.8, 5);
    expect(target.coverage[10]).toBeLessThan(1);
    expect(target.coverage[9]).toBeGreaterThan(0);
  });

  test("does nothing for radii under a few pixels", () => {
    const target = field(3, 1);
    target.depth.set([0, 1, 0]);
    target.coverage.fill(1);
    blurField(target, 3, 1, 1);
    expect([...target.depth]).toEqual([0, 1, 0]);
  });
});

test("posterizeDepth makes equal bands from 0 to 1", () => {
  const depth = new Float32Array([0, 0.2, 0.34, 0.5, 0.7, 0.99, 1]);
  posterizeDepth(depth, 3);
  expect([...depth]).toEqual([0, 0, 0.5, 0.5, 1, 1, 1]);
});

test("thresholdDepth makes a two-level silhouette", () => {
  const depth = new Float32Array([0, 0.49, 0.5, 0.9]);
  thresholdDepth(depth, 0.5);
  expect([...depth]).toEqual([0, 0, 1, 1]);
});

describe("rasteriseImage", () => {
  const assets = { picture: ramp(16, 8) };

  async function render(overrides: Partial<ImageLayer>, width = 32, height = 16) {
    const recipe = { ...defaultRecipe(), layers: [layer(overrides)], assets };
    return compositeDepth(recipe, width, height);
  }

  test("renders the image's luminance as depth", async () => {
    const depth = await render({});
    expect(depth[8 * 32]).toBe(0);
    expect(depth[8 * 32 + 31]).toBe(1);
    expect(depth[8 * 32 + 16]).toBeGreaterThan(0.4);
    expect(depth[8 * 32 + 16]).toBeLessThan(0.6);
  });

  test("applies invert, posterize and threshold in order", async () => {
    const inverted = await render({ invert: true });
    expect(inverted[8 * 32]).toBe(1);
    const bands = new Set(await render({ posterize: 4 }));
    expect([...bands].toSorted((a, b) => a - b)).toEqual(
      [0, 1 / 3, 2 / 3, 1].map((v) => Math.fround(v)),
    );
    const silhouette = await render({ posterize: 4, threshold: 0.5, invert: true });
    expect(new Set(silhouette)).toEqual(new Set([0, 1]));
    expect(silhouette[8 * 32]).toBe(1);
    expect(silhouette[8 * 32 + 31]).toBe(0);
  });

  test("converts RGBA assets to luminance", async () => {
    const rgba: Asset = {
      format: "rgba",
      width: 1,
      height: 1,
      data: new Uint8Array([0, 255, 0, 255]),
    };
    const recipe = { ...defaultRecipe(), layers: [layer()], assets: { picture: rgba } };
    const depth = await compositeDepth(recipe, 4, 4);
    expect(depth[5]).toBeCloseTo(182 / 255, 5);
  });

  test("draws nothing when the asset is missing", async () => {
    for (const asset of ["absent", "constructor"]) {
      const recipe = { ...defaultRecipe(), layers: [layer({ asset, blend: "replace" })] };
      const depth = await compositeDepth(recipe, 8, 8);
      expect(depth.every((v) => v === 0)).toBe(true);
    }
  });

  test("leaves the bars outside a contained image uncovered", async () => {
    const recipe = {
      ...defaultRecipe(),
      layers: [layer({ fit: "contain", invert: true })],
      assets,
    };
    const depth = await compositeDepth(recipe, 40, 10);
    // A 2:1 image on a 4:1 canvas sits in the middle 20 columns.
    expect(depth[5 * 40 + 5]).toBe(0);
    expect(depth[5 * 40 + 11]).toBeGreaterThan(0.9);
  });
});
