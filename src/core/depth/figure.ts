import type { SampleLayer } from "../recipe.ts";
import type { RasterContext } from "./raster.ts";

/** Bundled depth pictures, in the order they're offered. */
export const FIGURES = [
  { id: "heart", label: "Heart" },
  { id: "star", label: "Star" },
  { id: "rocket", label: "Rocket" },
  { id: "teapot", label: "Teapot" },
  { id: "knight", label: "Knight" },
  { id: "fish", label: "Fish" },
  { id: "cat", label: "Cat" },
  { id: "butterfly", label: "Butterfly" },
] as const;

export type FigureId = (typeof FIGURES)[number]["id"];

export const FIGURE_IDS: readonly FigureId[] = FIGURES.map((figure) => figure.id);

type Level = {
  size: number;
  /** Depth multiplied by coverage, from 0 to 1. */
  premultiplied: Float32Array;
  coverage: Float32Array;
};

/** A decoded figure, with ever halved copies for drawing it small without aliasing. */
export type FigureImage = { levels: Level[] };

function halve(level: Level): Level {
  const size = level.size >> 1;
  const premultiplied = new Float32Array(size * size);
  const coverage = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * 2 * level.size + x * 2;
      const j = i + level.size;
      const o = y * size + x;
      premultiplied[o] =
        (level.premultiplied[i] +
          level.premultiplied[i + 1] +
          level.premultiplied[j] +
          level.premultiplied[j + 1]) /
        4;
      coverage[o] =
        (level.coverage[i] + level.coverage[i + 1] + level.coverage[j] + level.coverage[j + 1]) / 4;
    }
  }
  return { size, premultiplied, coverage };
}

/**
 * Prepares a square figure from RGBA pixels whose red channel is depth (white is near)
 * and whose alpha is coverage.
 */
export function prepareFigure(rgba: Uint8Array | Uint8ClampedArray, size: number): FigureImage {
  if (!Number.isInteger(size) || size < 1 || rgba.length !== size * size * 4) {
    throw new RangeError("figure pixels don't match their size");
  }
  const premultiplied = new Float32Array(size * size);
  const coverage = new Float32Array(size * size);
  for (let i = 0; i < coverage.length; i++) {
    const alpha = rgba[i * 4 + 3] / 255;
    coverage[i] = alpha;
    premultiplied[i] = (rgba[i * 4] / 255) * alpha;
  }
  const levels: Level[] = [{ size, premultiplied, coverage }];
  while (levels[levels.length - 1].size >= 32 && levels[levels.length - 1].size % 2 === 0) {
    levels.push(halve(levels[levels.length - 1]));
  }
  return { levels };
}

/**
 * Draws a figure into a square `layer.size` canvas heights across, centred on
 * `layer.center`, with bilinear filtering from the smallest copy that's still at least
 * as large as the square.
 */
export function rasteriseFigure(
  layer: SampleLayer,
  { width, height, target }: RasterContext,
  figure: FigureImage,
): void {
  const side = layer.size * height;
  const level = figure.levels.findLast((candidate) => candidate.size >= side) ?? figure.levels[0];
  const { size, premultiplied, coverage } = level;
  const left = layer.center.x * width - side / 2;
  const top = layer.center.y * height - side / 2;
  const x0 = Math.max(0, Math.floor(left));
  const x1 = Math.min(width, Math.ceil(left + side));
  const y0 = Math.max(0, Math.floor(top));
  const y1 = Math.min(height, Math.ceil(top + side));
  const scale = size / side;
  for (let y = y0; y < y1; y++) {
    const v = Math.min(size - 1, Math.max(0, (y + 0.5 - top) * scale - 0.5));
    const v0 = Math.floor(v);
    const v1 = Math.min(size - 1, v0 + 1);
    const fv = v - v0;
    for (let x = x0; x < x1; x++) {
      const u = Math.min(size - 1, Math.max(0, (x + 0.5 - left) * scale - 0.5));
      const u0 = Math.floor(u);
      const u1 = Math.min(size - 1, u0 + 1);
      const fu = u - u0;
      const a = v0 * size + u0;
      const b = v0 * size + u1;
      const c = v1 * size + u0;
      const d = v1 * size + u1;
      const alpha =
        (coverage[a] * (1 - fu) + coverage[b] * fu) * (1 - fv) +
        (coverage[c] * (1 - fu) + coverage[d] * fu) * fv;
      if (alpha <= 1e-4) {
        continue;
      }
      const filled =
        (premultiplied[a] * (1 - fu) + premultiplied[b] * fu) * (1 - fv) +
        (premultiplied[c] * (1 - fu) + premultiplied[d] * fu) * fv;
      const i = y * width + x;
      target.coverage[i] = Math.min(1, alpha);
      target.depth[i] = Math.min(1, filled / alpha);
    }
  }
}
