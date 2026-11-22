import { mix32, type Random } from "../random.ts";

/**
 * A texture value from 0 to 1 at output pixel `(x, y)`; `x` is fractional when the
 * stereogram is oversampled. It is a pure function of its arguments, so values don't
 * depend on which pixels the renderer asks for or in what order.
 */
export type ValueFunction = (x: number, y: number) => number;

export type GeneratorContext = {
  /** The texture's own random sub-stream. */
  random: Random;
  /** Output size in pixels. */
  width: number;
  height: number;
  /** Feature size in output pixels, at least 1. */
  cellSize: number;
};

/** A uniformly distributed unsigned 32-bit hash of a cell, keyed by the seed. */
export function cellHash(key: number, cx: number, cy: number): number {
  return mix32((mix32((key ^ cx) >>> 0) + cy) >>> 0);
}

export const UINT32_RANGE = 0x1_0000_0000;
