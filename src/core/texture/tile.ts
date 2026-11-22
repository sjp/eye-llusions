import { grayPixels } from "../depth/image.ts";
import type { Random } from "../random.ts";
import type { Asset } from "../recipe.ts";
import { cellHash, UINT32_RANGE } from "./context.ts";

/** Packed `0xRRGGBBAA` colours of a resampled tile, row by row. */
type FittedTile = { width: number; height: number; colours: Uint32Array };

/**
 * Source pixel weights for each of `size` output pixels that evenly cover `source`
 * pixels, so every source pixel counts in proportion to the area it covers.
 */
function areaWeights(
  source: number,
  size: number,
  count: number,
): { index: number[]; weight: number[] }[] {
  const step = source / size;
  return Array.from({ length: count }, (_, i) => {
    const start = i * step;
    const end = Math.min(source, start + step);
    const index: number[] = [];
    const weight: number[] = [];
    for (let s = Math.floor(start); s < end; s++) {
      const w = Math.min(end, s + 1) - Math.max(start, s);
      if (w > 0) {
        index.push(Math.min(source - 1, s));
        weight.push(w / step);
      }
    }
    return { index, weight };
  });
}

/**
 * Resamples `asset` to `width` pixels wide, keeping its aspect, by area averaging.
 * Only the first `maxHeight` rows are made, since rows beyond the image are never seen.
 */
export function fitTile(asset: Asset, width: number, maxHeight = Infinity): FittedTile {
  const fullHeight = Math.max(1, Math.round((width * asset.height) / asset.width));
  const height = Math.max(1, Math.min(fullHeight, Math.ceil(maxHeight)));
  const channels = asset.format === "gray" ? 1 : 4;
  const { data } = asset;
  const columns = areaWeights(asset.width, width, width);
  const rows = areaWeights(asset.height, fullHeight, height);
  // Horizontal pass over the source rows that the kept output rows need.
  const lastRow = Math.min(asset.height, Math.ceil((height * asset.height) / fullHeight) + 1);
  const across = new Float32Array(lastRow * width * 3);
  for (let y = 0; y < lastRow; y++) {
    for (let x = 0; x < width; x++) {
      const { index, weight } = columns[x];
      let r = 0;
      let g = 0;
      let b = 0;
      for (let k = 0; k < index.length; k++) {
        const at = (y * asset.width + index[k]) * channels;
        const w = weight[k];
        if (channels === 1) {
          r += data[at] * w;
          g += data[at] * w;
          b += data[at] * w;
        } else {
          r += data[at] * w;
          g += data[at + 1] * w;
          b += data[at + 2] * w;
        }
      }
      const o = (y * width + x) * 3;
      across[o] = r;
      across[o + 1] = g;
      across[o + 2] = b;
    }
  }
  const colours = new Uint32Array(width * height);
  for (let y = 0; y < height; y++) {
    const { index, weight } = rows[y];
    for (let x = 0; x < width; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let k = 0; k < index.length; k++) {
        const at = (Math.min(lastRow - 1, index[k]) * width + x) * 3;
        r += across[at] * weight[k];
        g += across[at + 1] * weight[k];
        b += across[at + 2] * weight[k];
      }
      colours[y * width + x] =
        ((Math.round(r) << 24) | (Math.round(g) << 16) | (Math.round(b) << 8) | 0xff) >>> 0;
    }
  }
  return { width, height, colours };
}

function clampByte(value: number): number {
  return value < 0 ? 0 : value > 255 ? 255 : Math.round(value);
}

/**
 * Repeats `asset` so `divisions` copies fit exactly across each `strip` output pixels.
 * Each row of tiles is shifted by a seeded amount, so nothing repeats vertically.
 * `jitter` adds seeded grey noise in `noiseCell`-pixel cells, up to half the range.
 */
export function tileSampler(
  asset: Asset,
  options: {
    strip: number;
    divisions: number;
    jitter: number;
    height: number;
    noiseCell: number;
    random: Random;
  },
): (x: number, y: number) => number {
  const { strip, divisions, jitter, height, noiseCell, random } = options;
  const period = strip / divisions;
  const width = Math.max(1, Math.round(period));
  const scale = width / period;
  const tile = fitTile(asset, width, height * scale + 1);
  const shiftKey = random.uint32();
  const noiseKey = random.uint32();
  const fullHeight = Math.max(1, Math.round((width * asset.height) / asset.width));
  const amount = jitter * 255;
  return (x, y) => {
    const ty = Math.floor(y * scale);
    const band = Math.floor(ty / fullHeight);
    const row = Math.min(tile.height - 1, ty - band * fullHeight);
    const shift = band === 0 ? 0 : cellHash(shiftKey, band, 0) % width;
    const tx = (Math.floor(x * scale) + shift) % width;
    const colour = tile.colours[row * width + (tx < 0 ? tx + width : tx)];
    if (amount === 0) {
      return colour;
    }
    const noise =
      (cellHash(noiseKey, Math.floor(x / noiseCell), Math.floor(y / noiseCell)) / UINT32_RANGE -
        0.5) *
      amount;
    return (
      ((clampByte((colour >>> 24) + noise) << 24) |
        (clampByte(((colour >>> 16) & 0xff) + noise) << 16) |
        (clampByte(((colour >>> 8) & 0xff) + noise) << 8) |
        0xff) >>>
      0
    );
  };
}

/** Standard deviation of luminance, from 0 to 1, below which a patch counts as flat. */
const FLAT_DEVIATION = 0.015;

/** A tile is flagged when more than this fraction of its area is flat. */
export const FLAT_WARNING = 0.3;

/**
 * The fraction of the tile's area made of flat patches, about a 32nd of its longest
 * side across, that have too little detail to fuse on.
 */
export function flatFraction(asset: Asset): number {
  const gray = grayPixels(asset);
  const { width, height } = asset;
  const block = Math.max(2, Math.round(Math.max(width, height) / 32));
  let flat = 0;
  for (let by = 0; by < height; by += block) {
    for (let bx = 0; bx < width; bx += block) {
      const right = Math.min(width, bx + block);
      const bottom = Math.min(height, by + block);
      let sum = 0;
      let squares = 0;
      for (let y = by; y < bottom; y++) {
        for (let x = bx; x < right; x++) {
          const value = gray[y * width + x] / 255;
          sum += value;
          squares += value * value;
        }
      }
      const count = (right - bx) * (bottom - by);
      const mean = sum / count;
      const variance = Math.max(0, squares / count - mean * mean);
      if (Math.sqrt(variance) < FLAT_DEVIATION) {
        flat += count;
      }
    }
  }
  return flat / (width * height);
}
