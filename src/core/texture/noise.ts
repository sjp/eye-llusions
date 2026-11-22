import { mix32 } from "../random.ts";
import { UINT32_RANGE } from "./context.ts";

/** Smoothly interpolated random values on a unit lattice, from 0 to 1. */
function valueNoise(key: number, x: number, y: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  // cellHash, with each column's first round shared by its two corners.
  const left = mix32((key ^ ix) >>> 0);
  const right = mix32((key ^ (ix + 1)) >>> 0);
  const a = mix32((left + iy) >>> 0);
  const b = mix32((right + iy) >>> 0);
  const c = mix32((left + iy + 1) >>> 0);
  const d = mix32((right + iy + 1) >>> 0);
  const top = a + (b - a) * sx;
  const bottom = c + (d - c) * sx;
  return (top + (bottom - top) * sy) / UINT32_RANGE;
}

/** Standard deviation of a single octave of value noise. */
const OCTAVE_SPREAD = 0.24;

/**
 * Octaves of value noise, the first with lattice spacing `wavelength` pixels and each
 * next one half the size and half as strong. The sum is spread out again through a
 * logistic curve, so values cover 0 to 1 about evenly whatever the number of octaves.
 */
export function fractalNoise(
  keys: readonly number[],
  wavelength: number,
): (x: number, y: number) => number {
  // Octaves finer than a pixel would only add aliasing, so they're left out.
  const octaves = Math.max(1, Math.min(keys.length, Math.floor(Math.log2(wavelength)) + 1));
  let total = 0;
  let squares = 0;
  for (let i = 0; i < octaves; i++) {
    total += 0.5 ** i;
    squares += 0.25 ** i;
  }
  const spread = (OCTAVE_SPREAD * Math.sqrt(squares)) / total;
  // The logistic function with this slope is close to the normal distribution's CDF.
  const slope = -1.702 / spread;
  return (x, y) => {
    let sum = 0;
    let frequency = 1 / wavelength;
    let amplitude = 1;
    for (let i = 0; i < octaves; i++) {
      sum += amplitude * valueNoise(keys[i], x * frequency, y * frequency);
      frequency *= 2;
      amplitude *= 0.5;
    }
    return 1 / (1 + Math.exp(slope * (sum / total - 0.5)));
  };
}
