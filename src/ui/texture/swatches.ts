import type { Palette, Recipe, TextureSpec } from "../../core/recipe.ts";
import { PALETTE_LEVELS, paletteTable } from "../../core/texture/palette.ts";
import { buildSampler } from "../../core/texture/sampler.ts";

function toImageData(colours: Uint32Array, width: number, height: number): ImageData {
  const image = new ImageData(width, height);
  for (let i = 0; i < colours.length; i++) {
    const colour = colours[i];
    image.data[i * 4] = colour >>> 24;
    image.data[i * 4 + 1] = (colour >>> 16) & 0xff;
    image.data[i * 4 + 2] = (colour >>> 8) & 0xff;
    image.data[i * 4 + 3] = colour & 0xff;
  }
  return image;
}

/**
 * The texture at the scale it has in the image, cropped to one strip's width: the
 * swatch is `width` pixels wide and stands for a single pattern repeat.
 */
export function textureSwatch(
  texture: TextureSpec,
  recipe: Pick<Recipe, "seed" | "aspect" | "view" | "assets">,
  width: number,
  height: number,
): ImageData {
  const imageHeight = (width * recipe.view.repeats) / recipe.aspect;
  const sample = buildSampler(
    { ...recipe, texture },
    Math.round(width * recipe.view.repeats),
    imageHeight,
  );
  const colours = new Uint32Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      colours[y * width + x] = sample(x, y);
    }
  }
  return toImageData(colours, width, height);
}

/** The palette's colours from left to right. */
export function paletteSwatch(palette: Palette, width: number, height: number): ImageData {
  const table = paletteTable(palette);
  const colours = new Uint32Array(width * height);
  for (let x = 0; x < width; x++) {
    const colour = table[Math.round((x / Math.max(1, width - 1)) * (PALETTE_LEVELS - 1))];
    for (let y = 0; y < height; y++) {
      colours[y * width + x] = colour;
    }
  }
  return toImageData(colours, width, height);
}
