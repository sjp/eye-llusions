/**
 * Single-image random-dot stereograms by the constraint method of Thimbleby, Inglis and
 * Witten (1994), with hidden-surface removal.
 */

export type StereogramOptions = {
  /** Row-major, `width × height` values from 0 (far) to 1 (near). */
  depth: Float32Array;
  width: number;
  height: number;
  /** Pattern repeats across the image width where the input depth is 0, in both modes. */
  repeats: number;
  /** Depth range as a fraction of the far-plane strip width. */
  depthOfField: number;
  mode: "wall" | "cross";
  /** Horizontal supersampling factor, such as 1, 2 or 4. */
  oversample: number;
  /**
   * Colour of an unconstrained pixel, packed as `0xRRGGBBAA`. `x` is in output pixels
   * and is fractional when oversampling.
   */
  sample: (x: number, y: number) => number;
  /** Reused for the result when given; must hold `width × height × 4` bytes. */
  out?: Uint8ClampedArray;
  /**
   * Renders only rows `startRow` up to but not including `endRow` into `out`, leaving the
   * rest alone. Rows don't depend on each other, so rendering in bands gives the same
   * pixels as rendering all at once.
   */
  startRow?: number;
  endRow?: number;
  /**
   * How hidden points are found. `scan` steps along each sight line; `prefilter` first
   * rules out, per row, the points no sight line could be blocked from; `auto`, the
   * default, prefilters rows where scanning would be slow. All give the same pixels.
   */
  hiddenSurface?: "auto" | "scan" | "prefilter";
};

/**
 * Prefilter a row when scanning would take about this many steps per point, assuming
 * each scan runs from the row's mean height up to its highest point.
 */
const PREFILTER_STEPS = 4;

/** Slack for rounding in the prefilter, far above the error of summing steps. */
const PREFILTER_SLACK = 1e-6;

function assertPositiveInteger(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new RangeError(`${name} must be a positive integer, got ${String(value)}`);
  }
}

/**
 * Sets `lower[x]` and `upper[x]` to the most `rise[x ± t] − t·step` for any `t ≥ 1`,
 * with `step` at `lowStep` and `highStep`: how far the surface beside `x` rises above
 * lines climbing away from it at those rates per pixel.
 */
function reachOver(
  rise: Float32Array,
  lowStep: number,
  highStep: number,
  lower: Float64Array,
  upper: Float64Array,
): void {
  const w = rise.length;
  let low = -Infinity;
  let high = -Infinity;
  for (let x = 0; x < w; x++) {
    lower[x] = low;
    upper[x] = high;
    const r = rise[x];
    low = (low > r ? low : r) - lowStep;
    high = (high > r ? high : r) - highStep;
  }
  low = -Infinity;
  high = -Infinity;
  for (let x = w - 1; x >= 0; x--) {
    if (low > lower[x]) {
      lower[x] = low;
    }
    if (high > upper[x]) {
      upper[x] = high;
    }
    const r = rise[x];
    low = (low > r ? low : r) - lowStep;
    high = (high > r ? high : r) - highStep;
  }
}

/** Renders `depth` as RGBA pixels, `width × height × 4` bytes. */
export function renderStereogram(options: StereogramOptions): Uint8ClampedArray {
  const { depth, width, height, repeats, depthOfField: mu, mode, oversample, sample } = options;
  assertPositiveInteger("width", width);
  assertPositiveInteger("height", height);
  assertPositiveInteger("oversample", oversample);
  if (!(repeats > 0)) {
    throw new RangeError(`repeats must be positive, got ${String(repeats)}`);
  }
  if (!(mu > 0 && mu <= 1)) {
    throw new RangeError(`depthOfField must be in (0, 1], got ${String(mu)}`);
  }
  if (mode === "cross" && mu === 1) {
    throw new RangeError("depthOfField must be below 1 in cross-eyed mode");
  }
  if (depth.length !== width * height) {
    throw new RangeError(`depth must hold ${String(width * height)} values`);
  }
  const out = options.out ?? new Uint8ClampedArray(width * height * 4);
  if (out.length !== width * height * 4) {
    throw new RangeError(`out must hold ${String(width * height * 4)} bytes`);
  }
  const { startRow = 0, endRow = height, hiddenSurface = "auto" } = options;
  if (!Number.isInteger(startRow) || !Number.isInteger(endRow)) {
    throw new RangeError("startRow and endRow must be integers");
  }
  if (startRow < 0 || endRow > height || startRow > endRow) {
    throw new RangeError(`rows must lie within 0 to ${String(height)}`);
  }

  const cross = mode === "cross";
  const w = width * oversample;
  // The viewer's eye separation, twice the background strip width in both modes.
  const eye = (2 * w) / repeats;
  // Cross-eyed separations are those of the inverted depth viewed wall-eyed with this
  // wider eye separation, so that the background keeps the same strip width.
  const separationEye = cross ? ((2 - mu) * w) / ((1 - mu) * repeats) : eye;
  const wallStep = 2 / (mu * eye);
  const crossStep = 2 / eye;
  const z = new Float32Array(w);
  // Height of the surface in the real scene. Wall-eyed it is the depth, in units of the
  // depth range above the far plane, with the eyes at 2 / mu. Cross-eyed it is the
  // fraction of the viewing distance in front of the screen, with the eyes at 1.
  const rise = cross ? new Float32Array(w) : z;
  const same = new Int32Array(w);
  const colour = new Uint32Array(w);
  // How far the surface rises above each point's sight lines at their shallowest
  // (`lower`) and steepest (`upper`) climb: a point above `lower` can't be hidden, and
  // one below `upper` must be. Rounding is far below the slack allowed for it.
  let lower: Float64Array | undefined;
  let upper: Float64Array | undefined;

  for (let y = startRow; y < endRow; y++) {
    const rowStart = y * width;
    let rowMax = 0;
    let rowMin = Infinity;
    let rowSum = 0;
    for (let x = 0; x < w; x++) {
      const source = (x + 0.5) / oversample - 0.5;
      const i0 = source <= 0 ? 0 : Math.floor(source);
      const i1 = i0 + 1 < width ? i0 + 1 : width - 1;
      const f = source <= 0 ? 0 : source - i0;
      const d0 = depth[rowStart + i0];
      const d = d0 + (depth[rowStart + i1] - d0) * f;
      const clamped = d > 0 ? (d < 1 ? d : 1) : 0;
      z[x] = cross ? 1 - clamped : clamped;
      if (cross) {
        const zx = z[x];
        const s = ((1 - mu * zx) * separationEye) / (2 - mu * zx);
        rise[x] = s / (eye + s);
      }
      if (rise[x] > rowMax) {
        rowMax = rise[x];
      }
      if (rise[x] < rowMin) {
        rowMin = rise[x];
      }
      rowSum += rise[x];
      same[x] = x;
    }

    // Sight lines climb less steeply from higher points.
    const minStep = cross ? (1 - rowMax) * crossStep : (2 - mu * rowMax) * wallStep;
    const maxStep = cross ? (1 - rowMin) * crossStep : (2 - mu * rowMin) * wallStep;
    let rowLower: Float64Array | undefined;
    let rowUpper: Float64Array | undefined;
    if (
      hiddenSurface === "prefilter" ||
      (hiddenSurface === "auto" && rowMax - rowSum / w > PREFILTER_STEPS * minStep)
    ) {
      rowLower = lower ??= new Float64Array(w);
      rowUpper = upper ??= new Float64Array(w);
      reachOver(rise, minStep, maxStep, rowLower, rowUpper);
    }

    for (let x = 0; x < w; x++) {
      const zx = z[x];
      const s = Math.round(((1 - mu * zx) * separationEye) / (2 - mu * zx));
      let left = x - ((s + (s & y & 1)) >> 1);
      let right = left + s;
      if (left < 0 || right >= w) {
        continue;
      }
      // A point is hidden if the surface rises above either eye's line of sight to it.
      const hx = rise[x];
      let scan = true;
      if (rowLower !== undefined && rowUpper !== undefined) {
        if (rowUpper[x] - PREFILTER_SLACK > hx) {
          continue;
        }
        // The lowest points climb at exactly maxStep, so `upper` settles them both ways.
        scan = (hx === rowMin ? rowUpper[x] : rowLower[x]) + PREFILTER_SLACK >= hx;
      }
      if (scan) {
        const step = cross ? (1 - hx) * crossStep : (2 - mu * hx) * wallStep;
        let visible = true;
        for (let t = 1, ht = hx + step; ht <= rowMax; t++, ht += step) {
          const a = x - t;
          const b = x + t;
          if ((a >= 0 && rise[a] >= ht) || (b < w && rise[b] >= ht)) {
            visible = false;
            break;
          }
        }
        if (!visible) {
          continue;
        }
      }
      for (let k = same[left]; k !== left && k !== right; k = same[left]) {
        if (k < right) {
          left = k;
        } else {
          left = right;
          right = k;
        }
      }
      same[left] = right;
    }

    for (let x = w - 1; x >= 0; x--) {
      colour[x] = same[x] === x ? sample(x / oversample, y) >>> 0 : colour[same[x]];
    }

    let o = rowStart * 4;
    if (oversample === 1) {
      for (let x = 0; x < w; x++) {
        const c = colour[x];
        out[o++] = c >>> 24;
        out[o++] = (c >>> 16) & 0xff;
        out[o++] = (c >>> 8) & 0xff;
        out[o++] = c & 0xff;
      }
    } else {
      const half = oversample >> 1;
      for (let x = 0; x < w; x += oversample) {
        let r = half;
        let g = half;
        let b = half;
        let a = half;
        for (let k = x; k < x + oversample; k++) {
          const c = colour[k];
          r += c >>> 24;
          g += (c >>> 16) & 0xff;
          b += (c >>> 8) & 0xff;
          a += c & 0xff;
        }
        out[o++] = Math.floor(r / oversample);
        out[o++] = Math.floor(g / oversample);
        out[o++] = Math.floor(b / oversample);
        out[o++] = Math.floor(a / oversample);
      }
    }
  }
  return out;
}
