import type { Asset, ImageLayer } from "../recipe.ts";
import type { LayerField, RasterContext } from "./raster.ts";

/** Where the image lands on the canvas, in output pixels. */
type FitRect = { left: number; top: number; width: number; height: number };

/**
 * Rec. 709 luma of RGBA bytes composited over black, one byte per pixel, so transparent
 * areas come out far.
 */
export function luminance(rgba: Uint8Array | Uint8ClampedArray): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(rgba.length >> 2);
  for (let i = 0, o = 0; o < out.length; i += 4, o++) {
    const luma = 0.2126 * rgba[i] + 0.7152 * rgba[i + 1] + 0.0722 * rgba[i + 2];
    out[o] = Math.round((luma * rgba[i + 3]) / 255);
  }
  return out;
}

/** The size that fits `width × height` within `max` pixels on its longest side, never larger. */
export function downscaleSize(
  width: number,
  height: number,
  max: number,
): { width: number; height: number } {
  const scale = Math.min(1, max / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

const grays = new WeakMap<Asset, Uint8Array>();

/** The asset's pixels as one luminance byte each. */
export function grayPixels(asset: Asset): Uint8Array {
  if (asset.format === "gray") {
    return asset.data;
  }
  let gray = grays.get(asset);
  if (gray === undefined) {
    gray = luminance(asset.data);
    grays.set(asset, gray);
  }
  return gray;
}

/** Places an image of the given aspect on a `width × height` canvas, centred. */
export function fitRect(
  fit: ImageLayer["fit"],
  imageAspect: number,
  width: number,
  height: number,
): FitRect {
  if (fit === "stretch") {
    return { left: 0, top: 0, width, height };
  }
  const wider = imageAspect > width / height;
  const fitWidth = fit === "contain" ? wider : !wider;
  const w = fitWidth ? width : height * imageAspect;
  const h = fitWidth ? width / imageAspect : height;
  return { left: (width - w) / 2, top: (height - h) / 2, width: w, height: h };
}

/** How much of the unit span starting at `start` lies within [from, to]. */
function overlap(start: number, from: number, to: number): number {
  const amount = Math.min(start + 1, to) - Math.max(start, from);
  return amount <= 0 ? 0 : amount >= 1 ? 1 : amount;
}

/**
 * Samples a grey image into `target` with bilinear filtering: depth from 0 to 1, and
 * coverage for the part of each pixel the image rectangle covers.
 */
export function sampleImage(
  gray: Uint8Array,
  imageWidth: number,
  imageHeight: number,
  rect: FitRect,
  width: number,
  height: number,
  target: LayerField,
): void {
  const { depth, coverage } = target;
  const right = rect.left + rect.width;
  const bottom = rect.top + rect.height;
  const columns = new Int32Array(width * 2);
  const columnWeights = new Float32Array(width * 2);
  for (let x = 0; x < width; x++) {
    const u = ((x + 0.5 - rect.left) / rect.width) * imageWidth - 0.5;
    const u0 = Math.floor(u);
    const fu = u - u0;
    columns[x * 2] = Math.min(imageWidth - 1, Math.max(0, u0));
    columns[x * 2 + 1] = Math.min(imageWidth - 1, Math.max(0, u0 + 1));
    columnWeights[x * 2] = fu;
    columnWeights[x * 2 + 1] = overlap(x, rect.left, right);
  }
  for (let y = 0; y < height; y++) {
    const rowCover = overlap(y, rect.top, bottom);
    if (rowCover === 0) {
      continue;
    }
    const v = ((y + 0.5 - rect.top) / rect.height) * imageHeight - 0.5;
    const v0 = Math.floor(v);
    const fv = v - v0;
    const top = Math.min(imageHeight - 1, Math.max(0, v0)) * imageWidth;
    const below = Math.min(imageHeight - 1, Math.max(0, v0 + 1)) * imageWidth;
    const row = y * width;
    for (let x = 0; x < width; x++) {
      const cover = columnWeights[x * 2 + 1] * rowCover;
      if (cover === 0) {
        continue;
      }
      const a = columns[x * 2];
      const b = columns[x * 2 + 1];
      const fu = columnWeights[x * 2];
      const upper = gray[top + a] + (gray[top + b] - gray[top + a]) * fu;
      const lower = gray[below + a] + (gray[below + b] - gray[below + a]) * fu;
      depth[row + x] = (upper + (lower - upper) * fv) / 255;
      coverage[row + x] = cover;
    }
  }
}

/** Maps `black` to 0 and `white` to 1, clamping values outside them. */
export function applyLevels(depth: Float32Array, black: number, white: number): void {
  const scale = 1 / (white - black);
  for (let i = 0; i < depth.length; i++) {
    const v = (depth[i] - black) * scale;
    depth[i] = v < 0 ? 0 : v > 1 ? 1 : v;
  }
}

export function invertDepth(depth: Float32Array): void {
  for (let i = 0; i < depth.length; i++) {
    depth[i] = 1 - depth[i];
  }
}

/** One box-blur pass over `count` lines of `length` values, repeating the end values. */
function boxPass(
  from: Float32Array,
  to: Float32Array,
  count: number,
  length: number,
  lineStride: number,
  step: number,
  radius: number,
): void {
  const last = length - 1;
  const scale = 1 / (2 * radius + 1);
  for (let line = 0; line < count; line++) {
    const base = line * lineStride;
    let sum = 0;
    for (let k = -radius; k <= radius; k++) {
      sum += from[base + Math.min(last, Math.max(0, k)) * step];
    }
    for (let i = 0; i < length; i++) {
      to[base + i * step] = sum * scale;
      sum +=
        from[base + Math.min(last, i + radius + 1) * step] -
        from[base + Math.max(0, i - radius) * step];
    }
  }
}

/** Three box passes each way, approximating a Gaussian, in place. */
function blurValues(values: Float32Array, width: number, height: number, radius: number): void {
  const scratch = new Float32Array(values.length);
  for (let pass = 0; pass < 3; pass++) {
    boxPass(values, scratch, height, width, width, 1, radius);
    boxPass(scratch, values, width, height, 1, width, radius);
  }
}

/**
 * Blurs the field by about `radius` pixels in all. Depth is blurred weighted by coverage,
 * so the far area outside a contained image doesn't darken its edges.
 */
export function blurField(field: LayerField, width: number, height: number, radius: number): void {
  const box = Math.round(radius / 3);
  if (box < 1) {
    return;
  }
  const { depth, coverage } = field;
  for (let i = 0; i < depth.length; i++) {
    depth[i] *= coverage[i];
  }
  blurValues(depth, width, height, box);
  blurValues(coverage, width, height, box);
  for (let i = 0; i < depth.length; i++) {
    const alpha = coverage[i];
    depth[i] = alpha > 1e-6 ? Math.min(1, depth[i] / alpha) : 0;
  }
}

/** Rounds depth down into `levels` equal bands, spread from 0 to 1. */
export function posterizeDepth(depth: Float32Array, levels: number): void {
  const top = levels - 1;
  for (let i = 0; i < depth.length; i++) {
    depth[i] = Math.min(top, Math.floor(depth[i] * levels)) / top;
  }
}

/** 1 at or above `cutoff`, 0 below it. */
export function thresholdDepth(depth: Float32Array, cutoff: number): void {
  for (let i = 0; i < depth.length; i++) {
    depth[i] = depth[i] >= cutoff ? 1 : 0;
  }
}

/**
 * Rasterises an image layer: fit, levels, invert, blur, posterize, then threshold. A
 * layer whose asset the recipe lacks draws nothing.
 */
export function rasteriseImage(layer: ImageLayer, context: RasterContext): undefined {
  const { recipe, width, height, target } = context;
  if (!Object.hasOwn(recipe.assets, layer.asset)) {
    return;
  }
  const asset = recipe.assets[layer.asset];
  const rect = fitRect(layer.fit, asset.width / asset.height, width, height);
  sampleImage(grayPixels(asset), asset.width, asset.height, rect, width, height, target);
  applyLevels(target.depth, layer.levels.black, layer.levels.white);
  if (layer.invert) {
    invertDepth(target.depth);
  }
  blurField(target, width, height, layer.blur * height);
  if (layer.posterize !== null) {
    posterizeDepth(target.depth, layer.posterize);
  }
  if (layer.threshold !== null) {
    thresholdDepth(target.depth, layer.threshold);
  }
}
