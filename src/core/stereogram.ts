/**
 * Single-image random-dot stereograms by the constraint method of Thimbleby, Inglis and
 * Witten (1994), with hidden-surface removal.
 */

export type StereogramOptions = {
  /** Row-major, `width × height` values from 0 (far) to 1 (near). */
  depth: Float32Array;
  width: number;
  height: number;
  /** Pattern repeats across the image width at the far plane. */
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
};

function assertPositiveInteger(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new RangeError(`${name} must be a positive integer, got ${String(value)}`);
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
  if (depth.length !== width * height) {
    throw new RangeError(`depth must hold ${String(width * height)} values`);
  }
  const out = options.out ?? new Uint8ClampedArray(width * height * 4);
  if (out.length !== width * height * 4) {
    throw new RangeError(`out must hold ${String(width * height * 4)} bytes`);
  }

  const cross = mode === "cross";
  const w = width * oversample;
  const eye = (2 * w) / repeats;
  const ztStep = 2 / (mu * eye);
  const z = new Float32Array(w);
  const same = new Int32Array(w);
  const colour = new Uint32Array(w);

  for (let y = 0; y < height; y++) {
    const rowStart = y * width;
    let rowMax = 0;
    for (let x = 0; x < w; x++) {
      const source = (x + 0.5) / oversample - 0.5;
      const i0 = source <= 0 ? 0 : Math.floor(source);
      const i1 = i0 + 1 < width ? i0 + 1 : width - 1;
      const f = source <= 0 ? 0 : source - i0;
      const d0 = depth[rowStart + i0];
      const d = d0 + (depth[rowStart + i1] - d0) * f;
      const clamped = d > 0 ? (d < 1 ? d : 1) : 0;
      const value = cross ? 1 - clamped : clamped;
      z[x] = value;
      if (z[x] > rowMax) {
        rowMax = z[x];
      }
      same[x] = x;
    }

    for (let x = 0; x < w; x++) {
      const zx = z[x];
      const s = Math.round(((1 - mu * zx) * eye) / (2 - mu * zx));
      let left = x - ((s + (s & y & 1)) >> 1);
      let right = left + s;
      if (left < 0 || right >= w) {
        continue;
      }
      // A point is hidden if the surface rises above either eye's line of sight to it.
      const step = (2 - mu * zx) * ztStep;
      const limit = rowMax < 1 ? rowMax : 1;
      let visible = true;
      for (let t = 1, zt = zx + step; zt <= limit; t++, zt += step) {
        const a = x - t;
        const b = x + t;
        if ((a >= 0 && z[a] >= zt) || (b < w && z[b] >= zt)) {
          visible = false;
          break;
        }
      }
      if (!visible) {
        continue;
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
