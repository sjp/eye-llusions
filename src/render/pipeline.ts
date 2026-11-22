import { compositeDepth } from "../core/depth/composite.ts";
import type { RasteriserRegistry } from "../core/depth/raster.ts";
import type { Asset, Recipe } from "../core/recipe.ts";
import { renderStereogram } from "../core/stereogram.ts";
import { buildSampler } from "../core/texture/sampler.ts";
import type { RenderRequest } from "./protocol.ts";

/**
 * Updates the worker's asset cache from a request and returns the recipe with its
 * assets restored. Cached assets the recipe no longer holds are dropped.
 */
export function restoreAssets(cache: Map<string, Asset>, request: RenderRequest): Recipe {
  for (const [id, asset] of Object.entries(request.assets)) {
    cache.set(id, asset);
  }
  const keep = new Set(request.assetIds);
  for (const id of cache.keys()) {
    if (!keep.has(id)) {
      cache.delete(id);
    }
  }
  const assets: Record<string, Asset> = {};
  for (const id of request.assetIds) {
    const asset = cache.get(id);
    if (asset !== undefined) {
      assets[id] = asset;
    }
  }
  return { ...request.recipe, assets };
}

/**
 * Renders a recipe to `width × height × 4` RGBA bytes: the stereogram, or the depth
 * buffer as opaque grey from black (far) to white (near). Writes into `out` when it
 * has the right length.
 */
export async function renderPixels(
  recipe: Recipe,
  request: Pick<RenderRequest, "width" | "height" | "oversample" | "output">,
  registry: RasteriserRegistry,
  out?: Uint8ClampedArray<ArrayBuffer>,
): Promise<Uint8ClampedArray<ArrayBuffer>> {
  const { width, height, oversample, output } = request;
  const depth = await compositeDepth(recipe, width, height, registry);
  const pixels =
    out?.length === width * height * 4 ? out : new Uint8ClampedArray(width * height * 4);
  if (output === "depth") {
    for (let i = 0, o = 0; i < depth.length; i++) {
      const grey = Math.round(depth[i] * 255);
      pixels[o++] = grey;
      pixels[o++] = grey;
      pixels[o++] = grey;
      pixels[o++] = 255;
    }
    return pixels;
  }
  renderStereogram({
    depth,
    width,
    height,
    repeats: recipe.view.repeats,
    depthOfField: recipe.view.depthOfField,
    mode: recipe.view.mode,
    oversample,
    sample: buildSampler(recipe, width, height),
    out: pixels,
  });
  return pixels;
}
