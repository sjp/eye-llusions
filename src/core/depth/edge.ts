import type { TextLayer } from "../recipe.ts";

type EdgeProfile = TextLayer["edge"];

const FAR = 1e20;

/**
 * Squared distances along one line (Felzenszwalb and Huttenlocher): `f` holds the input
 * costs at `n` samples spaced `stride` apart from `offset` in `grid`, overwritten with
 * the lower envelope of the parabolas rooted at each.
 */
function transformLine(
  grid: Float64Array,
  offset: number,
  stride: number,
  n: number,
  f: Float64Array,
  roots: Int32Array,
  bounds: Float64Array,
): void {
  for (let q = 0; q < n; q++) {
    f[q] = grid[offset + q * stride];
  }
  let k = 0;
  roots[0] = 0;
  bounds[0] = -Infinity;
  bounds[1] = Infinity;
  for (let q = 1; q < n; q++) {
    const lift = f[q] + q * q;
    let r = roots[k];
    let s = (lift - (f[r] + r * r)) / (2 * (q - r));
    while (s <= bounds[k]) {
      k--;
      r = roots[k];
      s = (lift - (f[r] + r * r)) / (2 * (q - r));
    }
    k++;
    roots[k] = q;
    bounds[k] = s;
    bounds[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (bounds[k + 1] < q) {
      k++;
    }
    const r = roots[k];
    grid[offset + q * stride] = (q - r) * (q - r) + f[r];
  }
}

/**
 * Exact squared Euclidean distance, in pixels, from each pixel whose coverage is at
 * least a half to the nearest pixel whose coverage is below it; 0 for the latter.
 */
function insideDistances(coverage: Float32Array, width: number, height: number): Float64Array {
  const grid = new Float64Array(width * height);
  for (let i = 0; i < grid.length; i++) {
    grid[i] = coverage[i] >= 0.5 ? FAR : 0;
  }
  const longest = Math.max(width, height);
  const f = new Float64Array(longest);
  const roots = new Int32Array(longest);
  const bounds = new Float64Array(longest + 1);
  for (let x = 0; x < width; x++) {
    transformLine(grid, x, width, height, f, roots, bounds);
  }
  for (let y = 0; y < height; y++) {
    transformLine(grid, y * width, 1, width, f, roots, bounds);
  }
  return grid;
}

/**
 * Fills `depth` from a coverage mask of `width × height` pixels using an edge profile:
 * `flat` raises the whole shape to 1, while `bevel` (linear) and `round` (a quarter
 * circle) rise from 0 at the outline to 1 at `edgeWidth` pixels inside it. Areas
 * outside the mask count as beyond the outline, so callers should leave a margin of
 * at least `edgeWidth` around any part of the shape that continues past it.
 */
export function edgeDepth(
  coverage: Float32Array,
  width: number,
  height: number,
  profile: EdgeProfile,
  edgeWidth: number,
  depth: Float32Array,
): void {
  if (profile === "flat" || edgeWidth <= 0) {
    for (let i = 0; i < depth.length; i++) {
      depth[i] = coverage[i] > 0 ? 1 : 0;
    }
    return;
  }
  const distances = insideDistances(coverage, width, height);
  const scale = 1 / edgeWidth;
  for (let i = 0; i < depth.length; i++) {
    const squared = distances[i];
    if (squared === 0) {
      depth[i] = 0;
      continue;
    }
    // Pixel centres are half a pixel from the boundary with their outside neighbours.
    const t = Math.min(1, (Math.sqrt(squared) - 0.5) * scale);
    depth[i] = profile === "bevel" ? t : Math.sqrt(t * (2 - t));
  }
}
