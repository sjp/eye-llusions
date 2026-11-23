import { describe, expect, test } from "vitest";
import { CORE_RASTERISERS } from "../core/depth/composite.ts";
import { defaultRecipe, type Asset } from "../core/recipe.ts";
import { renderPixels, restoreAssets } from "./pipeline.ts";
import type { RenderRequest } from "./protocol.ts";

function asset(value: number): Asset {
  return { format: "gray", width: 1, height: 1, data: new Uint8Array([value]) };
}

function request(overrides: Partial<RenderRequest>): RenderRequest {
  return {
    requestId: 1,
    recipe: defaultRecipe(),
    width: 64,
    height: 36,
    oversample: 1,
    output: "stereogram",
    assets: {},
    assetIds: [],
    ...overrides,
  };
}

describe("restoreAssets", () => {
  test("caches sent assets and restores cached ones by ID", () => {
    const cache = new Map<string, Asset>();
    const a = asset(1);
    restoreAssets(cache, request({ assets: { a }, assetIds: ["a"] }));
    const recipe = restoreAssets(cache, request({ assetIds: ["a"] }));
    expect(recipe.assets).toEqual({ a });
  });

  test("forgets assets the recipe no longer holds", () => {
    const cache = new Map<string, Asset>();
    restoreAssets(cache, request({ assets: { a: asset(1), b: asset(2) }, assetIds: ["a", "b"] }));
    restoreAssets(cache, request({ assetIds: ["b"] }));
    expect([...cache.keys()]).toEqual(["b"]);
  });
});

describe("renderPixels", () => {
  test("renders the default recipe as an opaque, non-uniform stereogram", async () => {
    const pixels = await renderPixels(defaultRecipe(), request({}), CORE_RASTERISERS);
    expect(pixels.length).toBe(64 * 36 * 4);
    const colours = new Set<number>();
    for (let i = 0; i < pixels.length; i += 4) {
      expect(pixels[i + 3]).toBe(255);
      colours.add((pixels[i] << 16) | (pixels[i + 1] << 8) | pixels[i + 2]);
    }
    expect(colours.size).toBeGreaterThan(1);
  });

  test("renders depth as grey, white at the sphere's centre and black in the corner", async () => {
    const pixels = await renderPixels(
      defaultRecipe(),
      request({ output: "depth" }),
      CORE_RASTERISERS,
    );
    const centre = (18 * 64 + 32) * 4;
    expect(pixels[centre]).toBeGreaterThan(240);
    expect(pixels[centre + 1]).toBe(pixels[centre]);
    expect([...pixels.subarray(0, 4)]).toEqual([0, 0, 0, 255]);
  });

  test("reuses a buffer of the right size and replaces one of the wrong size", async () => {
    const right = new Uint8ClampedArray(64 * 36 * 4);
    const wrong = new Uint8ClampedArray(4);
    expect(await renderPixels(defaultRecipe(), request({}), CORE_RASTERISERS, right)).toBe(right);
    expect(await renderPixels(defaultRecipe(), request({}), CORE_RASTERISERS, wrong)).not.toBe(
      wrong,
    );
  });

  test("is deterministic", async () => {
    const first = await renderPixels(defaultRecipe(), request({}), CORE_RASTERISERS);
    const second = await renderPixels(defaultRecipe(), request({}), CORE_RASTERISERS);
    expect(second).toEqual(first);
  });

  test("pauses between layers and bands of rows without changing the pixels", async () => {
    const wide = request({ width: 2048, height: 96 });
    const whole = await renderPixels(defaultRecipe(), wide, CORE_RASTERISERS);
    let pauses = 0;
    const paused = await renderPixels(defaultRecipe(), wide, CORE_RASTERISERS, undefined, () => {
      pauses++;
      return Promise.resolve();
    });
    expect(paused).toEqual(whole);
    // One layer, then three bands of 32 rows.
    expect(pauses).toBe(4);
  });

  test("stops when the pause throws", async () => {
    let pauses = 0;
    const result = renderPixels(
      defaultRecipe(),
      request({ width: 2048, height: 96 }),
      CORE_RASTERISERS,
      undefined,
      () => {
        pauses++;
        return pauses === 3 ? Promise.reject(new Error("cancelled")) : Promise.resolve();
      },
    );
    await expect(result).rejects.toThrow("cancelled");
    expect(pauses).toBe(3);
  });
});
