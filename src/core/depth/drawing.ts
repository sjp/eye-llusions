import type { DrawingLayer, Stroke } from "../recipe.ts";
import type { RasterContext } from "./raster.ts";

type Bounds = { x0: number; y0: number; x1: number; y1: number };

/** Scratch buffers reused between calls of the same size. */
type Scratch = {
  size: number;
  mask: Float32Array;
  /** Each row's first and last painted column in `mask`, or an empty span (width, -1). */
  spans: Int32Array;
  rows: Float32Array;
  blurredHeight: Float32Array;
  blurredCoverage: Float32Array;
  sums: Float64Array;
};

let scratch: Scratch | undefined;

function scratchFor(width: number, height: number): Scratch {
  const size = width * height;
  if (scratch?.size !== size || scratch.sums.length !== width) {
    const spans = new Int32Array(2 * height);
    for (let y = 0; y < height; y++) {
      spans[2 * y] = width;
      spans[2 * y + 1] = -1;
    }
    scratch = {
      size,
      mask: new Float32Array(size),
      spans,
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

/** A row's interval of pixel-centre x positions, as [from, to]; empty when from > to. */
type Range = Float64Array;

/** Narrows `range` to the chord of a disc centred at `cx`, on a row `py` below its centre. */
function chord(range: Range, cx: number, py: number, outerSquared: number): void {
  const half = outerSquared - py * py;
  if (half > 0) {
    const reach = Math.sqrt(half);
    range[0] = Math.max(range[0], cx - reach);
    range[1] = Math.min(range[1], cx + reach);
  } else {
    range[0] = Infinity;
  }
}

/**
 * Narrows `range` to where `(x - vx) * nx + py * ny >= c`: a half-plane bounded near a
 * vertex at `vx`, on a row `py` below the vertex.
 */
function halfPlane(range: Range, vx: number, py: number, nx: number, ny: number, c: number) {
  const k = c - py * ny;
  if (nx > 0) {
    range[0] = Math.max(range[0], vx + k / nx);
  } else if (nx < 0) {
    range[1] = Math.min(range[1], vx + k / nx);
  } else if (k > 0) {
    range[0] = Infinity;
  }
}

/**
 * Writes the stroke's footprint into `mask` as the strongest brush weight over its
 * length, from 1 in the middle of the brush to 0 outside it, records each row's painted
 * span in `spans`, and returns the pixels it touched. Consecutive points are joined by
 * straight segments.
 *
 * Each pixel's weight comes from its distance to the nearest point of the stroke, so
 * each segment visits only the pixels that may lie nearest to it: its band, the wedge
 * of its start disc outside both it and the previous segment with any length, and, for
 * the last segment, the half of its end disc beyond it. Each row visits only where it
 * crosses those regions, so the work follows the painted area rather than the
 * segments' bounding boxes.
 */
function footprint(
  stroke: Stroke,
  width: number,
  height: number,
  mask: Float32Array,
  spans: Int32Array,
): Bounds | undefined {
  const radius = brushRadius(stroke, height);
  // The falloff runs inwards from just outside the radius: one pixel of anti-aliasing for
  // a hard brush, up to the whole radius for the softest.
  const falloff = Math.max(1, stroke.brush.softness * radius);
  const inverseFalloff = 1 / falloff;
  const outer = radius + 0.5;
  const outerSquared = outer * outer;
  const reach = Math.ceil(outer);
  const { points } = stroke;
  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;
  const count = points.length / 2;
  const segments = Math.max(1, count - 1);
  const regions = [new Float64Array(2), new Float64Array(2), new Float64Array(2)];
  let previousX = 0;
  let previousY = 0;
  for (let s = 0; s < segments; s++) {
    const ax = points[2 * s] * width;
    const ay = points[2 * s + 1] * height;
    const next = Math.min(s + 1, count - 1);
    const bx = points[2 * next] * width;
    const by = points[2 * next + 1] * height;
    const dx = bx - ax;
    const dy = by - ay;
    const last = s === segments - 1;
    const repeated = dx === 0 && dy === 0;
    // A repeated point inside the stroke adds nothing: the segments either side of it
    // paint its joint.
    if (repeated && s > 0 && !last) {
      continue;
    }
    const x0 = Math.max(0, Math.floor(Math.min(ax, bx)) - reach);
    const x1 = Math.min(width - 1, Math.ceil(Math.max(ax, bx)) + reach);
    const y0 = Math.max(0, Math.floor(Math.min(ay, by)) - reach);
    const y1 = Math.min(height - 1, Math.ceil(Math.max(ay, by)) + reach);
    const lengthSquared = dx * dx + dy * dy;
    const band = outer * Math.sqrt(lengthSquared);
    const inverseLength = lengthSquared > 0 ? 1 / lengthSquared : 0;
    for (let y = y0; y <= y1; y++) {
      const py = y + 0.5 - ay;
      const [body, start, end] = regions;
      // The band along the segment, between its ends and within the brush of its line.
      body[0] = -Infinity;
      body[1] = Infinity;
      if (lengthSquared > 0) {
        halfPlane(body, ax, py, dx, dy, 0);
        halfPlane(body, bx, y + 0.5 - by, -dx, -dy, 0);
        halfPlane(body, ax, py, -dy, dx, -band);
        halfPlane(body, ax, py, dy, -dx, -band);
      } else {
        body[0] = Infinity;
      }
      // The start disc beyond the previous segment and before this one.
      start[0] = -Infinity;
      start[1] = Infinity;
      chord(start, ax, py, outerSquared);
      if (start[0] <= start[1]) {
        halfPlane(start, ax, py, previousX, previousY, 0);
        halfPlane(start, ax, py, -dx, -dy, 0);
      }
      // The end disc beyond the last segment. Without length, the start disc covers it.
      end[0] = Infinity;
      end[1] = -Infinity;
      if (last && lengthSquared > 0) {
        end[0] = -Infinity;
        end[1] = Infinity;
        chord(end, bx, y + 0.5 - by, outerSquared);
        if (end[0] <= end[1]) {
          halfPlane(end, bx, y + 0.5 - by, dx, dy, 0);
        }
      }
      const row = y * width;
      for (let r = 0; r < 3; r++) {
        const range = regions[r];
        // Pixel centres sit at x + 0.5. The brush weight is zero at the edge of the
        // brush, and neighbouring regions share their boundaries, so rounding there
        // can't change the result.
        const from = Math.max(x0, Math.ceil(range[0] - 0.5));
        const to = Math.min(x1, Math.floor(range[1] - 0.5));
        if (from > to) {
          continue;
        }
        for (let x = from; x <= to; x++) {
          const px = x + 0.5 - ax;
          let t = (px * dx + py * dy) * inverseLength;
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          const ex = px - t * dx;
          const ey = py - t * dy;
          const distanceSquared = ex * ex + ey * ey;
          if (distanceSquared >= outerSquared) {
            continue;
          }
          let u = (outer - Math.sqrt(distanceSquared)) * inverseFalloff;
          if (u > 1) {
            u = 1;
          }
          const weight = u * u * (3 - 2 * u);
          if (weight > mask[row + x]) {
            mask[row + x] = weight;
          }
        }
        if (from < spans[2 * y]) {
          spans[2 * y] = from;
        }
        if (to > spans[2 * y + 1]) {
          spans[2 * y + 1] = to;
        }
        left = Math.min(left, from);
        right = Math.max(right, to);
        top = Math.min(top, y);
        bottom = Math.max(bottom, y);
      }
    }
    if (!repeated) {
      previousX = dx;
      previousY = dy;
    }
  }
  return right < 0 ? undefined : { x0: left, y0: top, x1: right, y1: bottom };
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
  const { mask, spans, rows, blurredHeight, blurredCoverage, sums } = scratchBuffers;
  const { mode, value } = stroke.brush;
  if (mode === "smooth") {
    const radius = Math.max(1, Math.round(brushRadius(stroke, height) / 3));
    boxBlur(heightField, blurredHeight, rows, sums, width, height, bounds, radius);
    boxBlur(coverage, blurredCoverage, rows, sums, width, height, bounds, radius);
  }
  for (let y = bounds.y0; y <= bounds.y1; y++) {
    const end = spans[2 * y + 1];
    for (let x = spans[2 * y]; x <= end; x++) {
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
  const scratchBuffers = scratchFor(width, height);
  const { mask, spans } = scratchBuffers;
  const { depth: heightField, coverage } = context.target;
  for (const stroke of layer.strokes) {
    const bounds = footprint(stroke, width, height, mask, spans);
    if (bounds === undefined) {
      continue;
    }
    apply(stroke, context, bounds, scratchBuffers);
    for (let y = bounds.y0; y <= bounds.y1; y++) {
      mask.fill(0, y * width + spans[2 * y], y * width + spans[2 * y + 1] + 1);
      spans[2 * y] = width;
      spans[2 * y + 1] = -1;
    }
  }
  for (let i = 0; i < heightField.length; i++) {
    const a = coverage[i];
    heightField[i] = a > 0 ? Math.min(1, heightField[i] / a) : 0;
  }
}
