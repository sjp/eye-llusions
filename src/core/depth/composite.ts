import type { Layer, Recipe } from "../recipe.ts";
import type { LayerField, RasterContext, Rasteriser, RasteriserRegistry } from "./raster.ts";
import { rasteriseDrawing } from "./drawing.ts";
import { rasteriseSample } from "./sample.ts";

/** Rasterisers that need nothing beyond plain TypeScript. */
export const CORE_RASTERISERS: RasteriserRegistry = {
  sample: rasteriseSample,
  drawing: rasteriseDrawing,
};

/** Runs a rasteriser if there is one, resolving to whether the layer was drawn. */
function run<L>(
  rasteriser: Rasteriser<L> | undefined,
  layer: L,
  context: RasterContext,
): boolean | Promise<boolean> {
  if (rasteriser === undefined) {
    return false;
  }
  const result = rasteriser(layer, context);
  return result instanceof Promise ? result.then(() => true) : true;
}

function rasterise(
  layer: Layer,
  registry: RasteriserRegistry,
  context: RasterContext,
): boolean | Promise<boolean> {
  switch (layer.kind) {
    case "sample":
      return run(registry.sample, layer, context);
    case "text":
      return run(registry.text, layer, context);
    case "drawing":
      return run(registry.drawing, layer, context);
    case "image":
      return run(registry.image, layer, context);
    default:
      return false;
  }
}

function blend(out: Float32Array, layer: Layer, { depth, coverage }: LayerField): void {
  const strength = layer.depth;
  for (let i = 0; i < out.length; i++) {
    const alpha = coverage[i];
    if (alpha <= 0) {
      continue;
    }
    const d = out[i];
    const v = depth[i] * strength;
    let next: number;
    switch (layer.blend) {
      case "max":
        next = v > d ? d + (v - d) * alpha : d;
        break;
      case "add":
        next = d + v * alpha;
        break;
      case "subtract":
        next = d - v * alpha;
        break;
      case "replace":
        next = d + (v - d) * alpha;
        break;
      default:
        next = d;
    }
    out[i] = next < 0 ? 0 : next > 1 ? 1 : next;
  }
}

/**
 * Flattens the recipe's visible layers, bottom to top, into one depth buffer of
 * `width * height` values from 0 (far) to 1 (near). Each layer's depth is scaled by its
 * strength and combined through its coverage using its blend mode. Layers of a kind
 * with no rasteriser in `registry` are skipped. Environments that can rasterise more
 * kinds pass a registry that extends `CORE_RASTERISERS`.
 */
export async function compositeDepth(
  recipe: Recipe,
  width: number,
  height: number,
  registry: RasteriserRegistry = CORE_RASTERISERS,
): Promise<Float32Array> {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new RangeError("width and height must be positive integers");
  }
  const out = new Float32Array(width * height);
  const target: LayerField = {
    depth: new Float32Array(width * height),
    coverage: new Float32Array(width * height),
  };
  const context: RasterContext = { recipe, width, height, target };
  for (const layer of recipe.layers) {
    if (!layer.visible) {
      continue;
    }
    target.depth.fill(0);
    target.coverage.fill(0);
    if (await rasterise(layer, registry, context)) {
      blend(out, layer, target);
    }
  }
  return out;
}
