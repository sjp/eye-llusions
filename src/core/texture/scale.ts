import type { TextureGenerator } from "../recipe.ts";

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
