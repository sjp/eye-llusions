import type { TextureGenerator } from "../recipe.ts";
import { voronoiCells } from "./cells.ts";
import { cellHash, UINT32_RANGE, type GeneratorContext, type ValueFunction } from "./context.ts";
import { fractalNoise } from "./noise.ts";
import { FEATURE_CELLS } from "./scale.ts";
import { scatteredShapes } from "./shapes.ts";

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

function keys(random: GeneratorContext["random"], count: number): number[] {
  return Array.from({ length: count }, () => random.uint32());
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
    case "fractalNoise":
      return fractalNoise(
        keys(context.random, generator.octaves),
        FEATURE_CELLS.fractalNoise * context.cellSize,
      );
    case "cells": {
      const [points, values] = keys(context.random, 2);
      return voronoiCells(
        points,
        values,
        FEATURE_CELLS.cells * context.cellSize,
        generator.shading,
      );
    }
    case "scatteredShapes": {
      const [glyph, ...background] = keys(context.random, 3);
      return scatteredShapes(
        { glyph, background },
        FEATURE_CELLS.scatteredShapes * context.cellSize,
        generator.density,
      );
    }
    default:
      return unknownGenerator(generator);
  }
}
