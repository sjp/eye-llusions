import { mix32, type Random } from "../random.ts";
import type { TextureGenerator } from "../recipe.ts";

/**
 * A texture value from 0 to 1 at output pixel `(x, y)`; `x` is fractional when the
 * stereogram is oversampled. It is a pure function of its arguments, so values don't
 * depend on which pixels the renderer asks for or in what order.
 */
export type ValueFunction = (x: number, y: number) => number;

type GeneratorContext = {
  /** The texture's own random sub-stream. */
  random: Random;
  /** Output size in pixels. */
  width: number;
  height: number;
  /** Feature size in output pixels, at least 1. */
  cellSize: number;
};

/** A uniformly distributed unsigned 32-bit hash of a cell, keyed by the seed. */
function cellHash(key: number, cx: number, cy: number): number {
  return mix32((mix32((key ^ cx) >>> 0) + cy) >>> 0);
}

const UINT32_RANGE = 0x1_0000_0000;

/** Two-tone dots: a `density` fraction of cells take value 1, the rest 0. */
function randomDots(density: number, { random, cellSize }: GeneratorContext): ValueFunction {
  const key = random.uint32();
  const threshold = density * UINT32_RANGE;
  return (x, y) =>
    cellHash(key, Math.floor(x / cellSize), Math.floor(y / cellSize)) < threshold ? 1 : 0;
}

/** Independent uniform values per cell. */
function colourNoise({ random, cellSize }: GeneratorContext): ValueFunction {
  const key = random.uint32();
  return (x, y) => cellHash(key, Math.floor(x / cellSize), Math.floor(y / cellSize)) / UINT32_RANGE;
}

function unknownGenerator(generator: never): never {
  throw new RangeError(`Unknown generator ${JSON.stringify(generator)}`);
}

export function createGenerator(
  generator: TextureGenerator,
  context: GeneratorContext,
): ValueFunction {
  switch (generator.type) {
    case "randomDots":
      return randomDots(generator.density, context);
    case "colourNoise":
      return colourNoise(context);
    default:
      return unknownGenerator(generator);
  }
}
