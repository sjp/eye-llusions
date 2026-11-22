import type { Recipe, TextureGenerator } from "../recipe.ts";

/**
 * Cell size at scale 1, as a fraction of the image height, so a texture looks the
 * same at preview and export resolutions.
 */
export const BASE_CELL = 1 / 400;

/** The size of each generator's main features, in cells. */
export const FEATURE_CELLS: Readonly<Record<TextureGenerator["type"], number>> = {
  randomDots: 1,
  colourNoise: 1,
  fractalNoise: 6,
  cells: 5,
  scatteredShapes: 6,
};

/**
 * The finest cell, as a fraction of the strip width. Finer detail blurs away when the
 * image is shown smaller than it was rendered.
 */
const FINEST_CELL = 1 / 200;

/** The coarsest main feature, as a fraction of the strip width: coarser is hard to fuse. */
const COARSEST_FEATURE = 1 / 5;

/** The range of texture scales that stay fusible for a canvas aspect and strip count. */
export function scaleLimits(
  generator: TextureGenerator["type"],
  aspect: number,
  repeats: number,
): { min: number; max: number } {
  const strip = aspect / repeats / BASE_CELL;
  return {
    min: FINEST_CELL * strip,
    max: (COARSEST_FEATURE * strip) / FEATURE_CELLS[generator],
  };
}

/** The recipe with its texture scale clamped to `scaleLimits`, or itself if in range. */
export function clampScale(recipe: Recipe): Recipe {
  const { min, max } = scaleLimits(
    recipe.texture.generator.type,
    recipe.aspect,
    recipe.view.repeats,
  );
  const scale = Math.min(max, Math.max(min, recipe.texture.scale));
  return scale === recipe.texture.scale
    ? recipe
    : { ...recipe, texture: { ...recipe.texture, scale } };
}
