import type { DrawingLayer, Stroke } from "../recipe.ts";
import type { RasterContext } from "./raster.ts";

type Bounds = { x0: number; y0: number; x1: number; y1: number };

/** Scratch buffers reused between calls of the same size. */
type Scratch = {
  size: number;
  mask: Float32Array;
  rows: Float32Array;
  blurredHeight: Float32Array;
  blurredCoverage: Float32Array;
  sums: Float64Array;
};

let scratch: Scratch | undefined;

function scratchFor(width: number, size: number): Scratch {
  if (scratch?.size !== size || scratch.sums.length !== width) {
    scratch = {
      size,
      mask: new Float32Array(size),
      rows: new Float32Array(size),
      blurredHeight: new Float32Array(size),
      blurredCoverage: new Float32Array(size),
      sums: new Float64Array(width),
    };
  }
  return scratch;
}

/** Brush radius in pixels at a canvas `height` pixels tall. */
function brushRadius(stroke: Stroke, height: number): number {
  return Math.max(0.5, (stroke.brush.size * height) / 2);
}

/**
 * Writes the stroke's footprint into `mask` as the strongest brush weight over its
 * length, from 1 in the middle of the brush to 0 outside it, and returns the pixels it
 * touched. Consecutive points are joined by straight segments.
 */
function footprint(
  stroke: Stroke,
  width: number,
  height: number,
  mask: Float32Array,
): Bounds | undefined {
  const radius = brushRadius(stroke, height);
  // The falloff runs inwards from just outside the radius: one pixel of anti-aliasing for
  // a hard brush, up to the whole radius for the softest.
  const falloff = Math.max(1, stroke.brush.softness * radius);
  const outer = radius + 0.5;
  const reach = Math.ceil(outer);
  const { points } = stroke;
  let bounds: Bounds | undefined;
  const count = points.length / 2;
  for (let s = 0; s < Math.max(1, count - 1); s++) {
    const ax = points[2 * s] * width;
    const ay = points[2 * s + 1] * height;
    const next = Math.min(s + 1, count - 1);
    const bx = points[2 * next] * width;
    const by = points[2 * next + 1] * height;
    const x0 = Math.max(0, Math.floor(Math.min(ax, bx)) - reach);
    const x1 = Math.min(width - 1, Math.ceil(Math.max(ax, bx)) + reach);
    const y0 = Math.max(0, Math.floor(Math.min(ay, by)) - reach);
    const y1 = Math.min(height - 1, Math.ceil(Math.max(ay, by)) + reach);
    if (x0 > x1 || y0 > y1) {
      continue;
    }
    bounds =
      bounds === undefined
        ? { x0, y0, x1, y1 }
        : {
            x0: Math.min(bounds.x0, x0),
            y0: Math.min(bounds.y0, y0),
            x1: Math.max(bounds.x1, x1),
            y1: Math.max(bounds.y1, y1),
          };
    const dx = bx - ax;
    const dy = by - ay;
    const lengthSquared = dx * dx + dy * dy;
    for (let y = y0; y <= y1; y++) {
      const py = y + 0.5 - ay;
      const row = y * width;
      for (let x = x0; x <= x1; x++) {
        const px = x + 0.5 - ax;
        let t = lengthSquared > 0 ? (px * dx + py * dy) / lengthSquared : 0;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const ex = px - t * dx;
        const ey = py - t * dy;
        const distanceSquared = ex * ex + ey * ey;
        if (distanceSquared >= outer * outer) {
          continue;
        }
        let u = (outer - Math.sqrt(distanceSquared)) / falloff;
        if (u > 1) {
          u = 1;
        }
        const weight = u * u * (3 - 2 * u);
        if (weight > mask[row + x]) {
          mask[row + x] = weight;
        }
      }
    }
  }
  return bounds;
}

/**
 * Box-blurs `source` inside `bounds` into `out`, reading up to `radius` pixels beyond
 * and repeating the canvas edges. `rows` holds the horizontal pass and `sums` (at least
 * the bounds' width) the running column sums.
 */
function boxBlur(
  source: Float32Array,
  out: Float32Array,
  rows: Float32Array,
  sums: Float64Array,
  width: number,
  height: number,
  bounds: Bounds,
  radius: number,
): void {
  const { x0, x1, y0, y1 } = bounds;
  const ry0 = Math.max(0, y0 - radius);
  const ry1 = Math.min(height - 1, y1 + radius);
  const span = 2 * radius + 1;
  const last = width - 1;
  for (let y = ry0; y <= ry1; y++) {
    const row = y * width;
    let sum = 0;
    for (let k = x0 - radius; k <= x0 + radius; k++) {
      sum += source[row + (k < 0 ? 0 : k > last ? last : k)];
    }
    rows[row + x0] = sum;
    for (let x = x0 + 1; x <= x1; x++) {
      const enter = x + radius;
      const leave = x - radius - 1;
      sum += source[row + (enter > last ? last : enter)] - source[row + (leave < 0 ? 0 : leave)];
      rows[row + x] = sum;
    }
  }
  const clampRow = (k: number) => (k < ry0 ? ry0 : k > ry1 ? ry1 : k) * width;
  const scale = 1 / (span * span);
  sums.fill(0, 0, x1 - x0 + 1);
  for (let k = y0 - radius; k <= y0 + radius; k++) {
    const row = clampRow(k);
    for (let x = x0; x <= x1; x++) {
      sums[x - x0] += rows[row + x];
    }
  }
  for (let y = y0; y <= y1; y++) {
    if (y > y0) {
      const enter = clampRow(y + radius);
      const leave = clampRow(y - radius - 1);
      for (let x = x0; x <= x1; x++) {
        sums[x - x0] += rows[enter + x] - rows[leave + x];
      }
    }
    const row = y * width;
    for (let x = x0; x <= x1; x++) {
      out[row + x] = sums[x - x0] * scale;
    }
  }
}

/**
 * Applies one stroke to the layer's `height` (depth times coverage, so that it adds
 * linearly) and `coverage` through the stroke's footprint `mask`.
 */
function apply(
  stroke: Stroke,
  context: RasterContext,
  bounds: Bounds,
  scratchBuffers: Scratch,
): void {
  const { width, height } = context;
  const { depth: heightField, coverage } = context.target;
  const { mask, rows, blurredHeight, blurredCoverage, sums } = scratchBuffers;
  const { mode, value } = stroke.brush;
  if (mode === "smooth") {
    const radius = Math.max(1, Math.round(brushRadius(stroke, height) / 3));
    boxBlur(heightField, blurredHeight, rows, sums, width, height, bounds, radius);
    boxBlur(coverage, blurredCoverage, rows, sums, width, height, bounds, radius);
  }
  for (let y = bounds.y0; y <= bounds.y1; y++) {
    for (let x = bounds.x0; x <= bounds.x1; x++) {
      const i = y * width + x;
      const w = mask[i];
      if (w <= 0) {
        continue;
      }
      let a = coverage[i];
      let h = heightField[i];
      switch (mode) {
        case "set":
          a += (1 - a) * w;
          h += (value - h) * w;
          break;
        case "raise":
          a += (1 - a) * w;
          h += value * w;
          break;
        case "lower":
          h -= value * w;
          break;
        case "smooth":
          a += (blurredCoverage[i] - a) * w;
          h += (blurredHeight[i] - h) * w;
          break;
        default:
          break;
      }
      heightField[i] = h < 0 ? 0 : h > a ? a : h;
      coverage[i] = a;
    }
  }
}

/**
 * Paints a drawing layer's strokes in order. `set` paints towards the brush value,
 * `raise` and `lower` add or remove it, clamped to 0..1, and `smooth` blurs what is
 * already painted. Brush weight falls off from the middle with the brush's softness.
 */
export function rasteriseDrawing(layer: DrawingLayer, context: RasterContext): void {
  const { width, height } = context;
  const scratchBuffers = scratchFor(width, width * height);
  const { mask } = scratchBuffers;
  const { depth: heightField, coverage } = context.target;
  for (const stroke of layer.strokes) {
    const bounds = footprint(stroke, width, height, mask);
    if (bounds === undefined) {
      continue;
    }
    apply(stroke, context, bounds, scratchBuffers);
    for (let y = bounds.y0; y <= bounds.y1; y++) {
      mask.fill(0, y * width + bounds.x0, y * width + bounds.x1 + 1);
    }
  }
  for (let i = 0; i < heightField.length; i++) {
    const a = coverage[i];
    heightField[i] = a > 0 ? Math.min(1, heightField[i] / a) : 0;
  }
}
