import { describe, expect, test } from "vitest";
import { CORE_RASTERISERS, compositeDepth } from "../core/depth/composite.ts";
import type { RasteriserRegistry } from "../core/depth/raster.ts";
import { defaultRecipe, type Asset } from "../core/recipe.ts";
import { createDepthCache, renderPixels, restoreAssets } from "./pipeline.ts";
import type { RenderRequest } from "./protocol.ts";

function asset(value: number): Asset {
  return { format: "gray", width: 1, height: 1, data: new Uint8Array([value]) };
}

function request(overrides: Partial<RenderRequest>): RenderRequest {
  return {
    type: "render",
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
    expect(restoreAssets(cache, request({ assets: { a }, assetIds: ["a"] })).changed).toBe(true);
    const { recipe, changed } = restoreAssets(cache, request({ assetIds: ["a"] }));
    expect(recipe.assets).toEqual({ a });
    expect(changed).toBe(false);
  });

  test("forgets assets the recipe no longer holds", () => {
    const cache = new Map<string, Asset>();
    restoreAssets(cache, request({ assets: { a: asset(1), b: asset(2) }, assetIds: ["a", "b"] }));
    expect(restoreAssets(cache, request({ assetIds: ["b"] })).changed).toBe(true);
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

describe("createDepthCache", () => {
  function counting(): { registry: RasteriserRegistry; runs: () => number } {
    let runs = 0;
    const sample = CORE_RASTERISERS.sample;
    return {
      registry: {
        ...CORE_RASTERISERS,
        sample: (layer, context) => {
          runs++;
          return sample?.(layer, context);
        },
      },
      runs: () => runs,
    };
  }

  test("reuses depth when only the view or texture changes", async () => {
    const cache = createDepthCache();
    const { registry, runs } = counting();
    const recipe = defaultRecipe();
    const first = await cache.composite(recipe, 64, 36, registry);
    const changed = {
      ...recipe,
      view: { ...recipe.view, repeats: 5 },
      texture: { ...recipe.texture, scale: 2 },
      seed: 1,
    };
    expect(await cache.composite(structuredClone(changed), 64, 36, registry)).toBe(first);
    expect(runs()).toBe(1);
  });

  test("composites again when the layers, size or assets change", async () => {
    const cache = createDepthCache();
    const { registry, runs } = counting();
    const recipe = defaultRecipe();
    const first = Array.from(await cache.composite(recipe, 64, 36, registry));
    const [sphere] = recipe.layers;
    const moved = { ...recipe, layers: [{ ...sphere, depth: 0.5 }] };
    const second = Array.from(await cache.composite(moved, 64, 36, registry));
    expect(second).not.toEqual(first);
    expect(Array.from(await compositeDepth(moved, 64, 36))).toEqual(second);
    await cache.composite(moved, 32, 18, registry);
    cache.assetsChanged();
    await cache.composite(moved, 64, 36, registry);
    expect(runs()).toBe(4);
  });

  test("keeps a draft and a full size at once", async () => {
    const cache = createDepthCache();
    const { registry, runs } = counting();
    const recipe = defaultRecipe();
    for (let round = 0; round < 3; round++) {
      await cache.composite(recipe, 64, 36, registry);
      await cache.composite(recipe, 32, 18, registry);
    }
    expect(runs()).toBe(2);
  });

  test("forgets a result that was stopped part way", async () => {
    const cache = createDepthCache();
    const { registry, runs } = counting();
    const recipe = defaultRecipe();
    await cache.composite(recipe, 64, 36, registry);
    const moved = { ...recipe, layers: [{ ...recipe.layers[0], depth: 0.5 }] };
    await expect(
      cache.composite(moved, 64, 36, registry, () => Promise.reject(new Error("cancelled"))),
    ).rejects.toThrow("cancelled");
    const depth = await cache.composite(recipe, 64, 36, registry);
    expect(Array.from(depth)).toEqual(Array.from(await compositeDepth(recipe, 64, 36)));
    expect(runs()).toBe(2);
  });
});
