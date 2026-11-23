import type { Layer, Recipe } from "../recipe.ts";
import type {
  LayerField,
  RasterBounds,
  RasterContext,
  Rasteriser,
  RasteriserRegistry,
} from "./raster.ts";
import { rasteriseDrawing } from "./drawing.ts";
import { rasteriseImage } from "./image.ts";
import { rasteriseSample } from "./sample.ts";

/** Rasterisers that need nothing beyond plain TypeScript. */
export const CORE_RASTERISERS: RasteriserRegistry = {
  sample: rasteriseSample,
  drawing: rasteriseDrawing,
  image: rasteriseImage,
};

type Drawn = RasterBounds | undefined;

/** `bounds` clipped to the canvas, or the whole canvas when there are none. */
function clip(bounds: RasterBounds | undefined, width: number, height: number): RasterBounds {
  if (bounds === undefined) {
    return { x0: 0, y0: 0, x1: width, y1: height };
  }
  const x0 = Math.max(0, bounds.x0);
  const y0 = Math.max(0, bounds.y0);
  return {
    x0,
    y0,
    x1: Math.max(x0, Math.min(width, bounds.x1)),
    y1: Math.max(y0, Math.min(height, bounds.y1)),
  };
}

/**
 * Runs a rasteriser if there is one, resolving to the canvas bounds it drew within, or
 * to undefined if the layer wasn't drawn.
 */
function run<L>(
  rasteriser: Rasteriser<L> | undefined,
  layer: L,
  context: RasterContext,
): Drawn | Promise<Drawn> {
  if (rasteriser === undefined) {
    return undefined;
  }
  const { width, height } = context;
  const result = rasteriser(layer, context);
  return result instanceof Promise
    ? result.then((bounds) => clip(bounds, width, height))
    : clip(result, width, height);
}

function rasterise(
  layer: Layer,
  registry: RasteriserRegistry,
  context: RasterContext,
): Drawn | Promise<Drawn> {
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
      return undefined;
  }
}

function blend(
  out: Float32Array,
  layer: Layer,
  { depth, coverage }: LayerField,
  width: number,
  { x0, y0, x1, y1 }: RasterBounds,
): void {
  const strength = layer.depth;
  for (let y = y0; y < y1; y++) {
    for (let i = y * width + x0, end = y * width + x1; i < end; i++) {
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
}

/** Zeroes `bounds` of a layer field, which is otherwise zero. */
function clear({ depth, coverage }: LayerField, width: number, bounds: RasterBounds): void {
  for (let y = bounds.y0; y < bounds.y1; y++) {
    depth.fill(0, y * width + bounds.x0, y * width + bounds.x1);
    coverage.fill(0, y * width + bounds.x0, y * width + bounds.x1);
  }
}

/** Buffers `compositeDepth` may reuse; any of the wrong length are replaced. */
type CompositeBuffers = {
  /** Becomes the result. */
  out?: Float32Array | undefined;
  /** Scratch space for each layer in turn. */
  target?: LayerField;
};

function sized(buffer: Float32Array | undefined, length: number): Float32Array {
  return buffer?.length === length ? buffer : new Float32Array(length);
}

/**
 * Flattens the recipe's visible layers, bottom to top, into one depth buffer of
 * `width * height` values from 0 (far) to 1 (near). Each layer's depth is scaled by its
 * strength and combined through its coverage using its blend mode. Layers of a kind
 * with no rasteriser in `registry` are skipped. Environments that can rasterise more
 * kinds pass a registry that extends `CORE_RASTERISERS`. `pause`, when given, is awaited
 * before each visible layer; a caller can use it to yield or to stop by throwing.
 */
export async function compositeDepth(
  recipe: Recipe,
  width: number,
  height: number,
  registry: RasteriserRegistry = CORE_RASTERISERS,
  pause?: () => Promise<void>,
  buffers: CompositeBuffers = {},
): Promise<Float32Array> {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new RangeError("width and height must be positive integers");
  }
  const size = width * height;
  const out = sized(buffers.out, size).fill(0);
  const target: LayerField = {
    depth: sized(buffers.target?.depth, size),
    coverage: sized(buffers.target?.coverage, size),
  };
  const context: RasterContext = { recipe, width, height, target };
  // Where the target may hold values from before: anywhere in reused buffers.
  let dirty: RasterBounds | undefined = { x0: 0, y0: 0, x1: width, y1: height };
  for (const layer of recipe.layers) {
    if (!layer.visible) {
      continue;
    }
    await pause?.();
    if (dirty !== undefined) {
      clear(target, width, dirty);
    }
    dirty = await rasterise(layer, registry, context);
    if (dirty !== undefined) {
      blend(out, layer, target, width, dirty);
    }
  }
  return out;
}
