import { compositeDepth } from "../core/depth/composite.ts";
import type { LayerField, RasteriserRegistry } from "../core/depth/raster.ts";
import type { Asset, Layer, Recipe } from "../core/recipe.ts";
import { renderStereogram } from "../core/stereogram.ts";
import { buildSampler } from "../core/texture/sampler.ts";
import type { RenderRequest } from "./protocol.ts";

/**
 * Updates the worker's asset cache from a request and returns the recipe with its
 * assets restored, and whether the cache changed. Cached assets the recipe no longer
 * holds are dropped.
 */
export function restoreAssets(
  cache: Map<string, Asset>,
  request: RenderRequest,
): { recipe: Recipe; changed: boolean } {
  let changed = false;
  for (const [id, asset] of Object.entries(request.assets)) {
    cache.set(id, asset);
    changed = true;
  }
  const keep = new Set(request.assetIds);
  for (const id of cache.keys()) {
    if (!keep.has(id)) {
      cache.delete(id);
      changed = true;
    }
  }
  const assets: Record<string, Asset> = {};
  for (const id of request.assetIds) {
    const asset = cache.get(id);
    if (asset !== undefined) {
      assets[id] = asset;
    }
  }
  return { recipe: { ...request.recipe, assets }, changed };
}

/** Roughly how many stereogram samples to compute between pauses. */
const BAND_SAMPLES = 1 << 16;

/**
 * Renders a recipe to `width × height × 4` RGBA bytes: the stereogram, or the depth
 * buffer as opaque grey from black (far) to white (near). Writes into `out` when it
 * has the right length. `pause` is awaited between layers and between bands of rows;
 * it can yield to other work or stop the render by throwing. The pixels don't depend
 * on it.
 */
export async function renderPixels(
  recipe: Recipe,
  request: Pick<RenderRequest, "width" | "height" | "oversample" | "output">,
  registry: RasteriserRegistry,
  out?: Uint8ClampedArray<ArrayBuffer>,
  pause?: () => Promise<void>,
  composite: typeof compositeDepth = compositeDepth,
): Promise<Uint8ClampedArray<ArrayBuffer>> {
  const { width, height, oversample, output } = request;
  const depth = await composite(recipe, width, height, registry, pause);
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
  const sample = buildSampler(recipe, width, height);
  const band = Math.max(1, Math.floor(BAND_SAMPLES / (width * oversample)));
  for (let startRow = 0; startRow < height; startRow += band) {
    await pause?.();
    renderStereogram({
      depth,
      width,
      height,
      repeats: recipe.view.repeats,
      depthOfField: recipe.view.depthOfField,
      mode: recipe.view.mode,
      oversample,
      sample,
      out: pixels,
      startRow,
      endRow: Math.min(height, startRow + band),
    });
  }
  return pixels;
}

/** Whether two plain, serialisable values are equal, comparing arrays and objects by content. */
function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) {
    return true;
  }
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) {
    return false;
  }
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) {
      return false;
    }
    for (let i = 0; i < a.length; i++) {
      if (!sameValue(a[i], b[i])) {
        return false;
      }
    }
    return true;
  }
  if (Array.isArray(b)) {
    return false;
  }
  const entries = Object.entries(a);
  if (entries.length !== Object.keys(b).length) {
    return false;
  }
  return entries.every(
    ([key, value]) => Object.hasOwn(b, key) && sameValue(value, Reflect.get(b, key)),
  );
}

type DepthEntry = {
  width: number;
  height: number;
  layers: Layer[];
  assetGeneration: number;
  depth: Float32Array;
};

/** Depth buffers kept, one per size, so drafts and full renders don't evict each other. */
const DEPTH_ENTRIES = 2;

/**
 * Composites depth like `compositeDepth`, but keeps the most recent results and their
 * scratch space. A request with the same size, layers and assets as a kept result gets
 * it back unchanged: view and texture changes don't composite again. Call `assetsChanged`
 * whenever an asset is added, replaced or dropped. Results must not be modified.
 */
export function createDepthCache(): {
  composite: typeof compositeDepth;
  assetsChanged: () => void;
} {
  let assetGeneration = 0;
  const entries: DepthEntry[] = [];
  let scratch: LayerField = { depth: new Float32Array(0), coverage: new Float32Array(0) };

  const composite: typeof compositeDepth = async (recipe, width, height, registry, pause) => {
    const { layers } = recipe;
    const index = entries.findIndex((entry) => entry.width === width && entry.height === height);
    const entry = index === -1 ? undefined : entries[index];
    if (entry?.assetGeneration === assetGeneration && sameValue(entry.layers, layers)) {
      entries.splice(index, 1);
      entries.unshift(entry);
      return entry.depth;
    }
    // Drop a stale entry first, so a render stopped part way never leaves it behind.
    if (entry !== undefined) {
      entries.splice(index, 1);
    }
    const size = width * height;
    if (scratch.depth.length < size) {
      scratch = { depth: new Float32Array(size), coverage: new Float32Array(size) };
    }
    const depth = await compositeDepth(recipe, width, height, registry, pause, {
      out: entry?.depth,
      target: {
        depth: scratch.depth.subarray(0, size),
        coverage: scratch.coverage.subarray(0, size),
      },
    });
    entries.unshift({ width, height, layers, assetGeneration, depth });
    entries.length = Math.min(entries.length, DEPTH_ENTRIES);
    return depth;
  };

  return {
    composite,
    assetsChanged: () => {
      assetGeneration++;
    },
  };
}
