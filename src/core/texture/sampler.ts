import { createRandom, deriveSeed } from "../random.ts";
import type { TextureSpec } from "../recipe.ts";
import { createGenerator } from "./generators.ts";
import { PALETTE_LEVELS, paletteTable } from "./palette.ts";

/**
 * Feature size at scale 1, as a fraction of the image height, so a texture looks the
 * same at preview and export resolutions.
 */
const BASE_CELL = 1 / 400;

/**
 * The texture's colour at output pixel `(x, y)`, packed as `0xRRGGBBAA`, in the form
 * the stereogram renderer's `sample` option takes.
 */
export function buildSampler(
  texture: TextureSpec,
  seed: number,
  width: number,
  height: number,
): (x: number, y: number) => number {
  const values = createGenerator(texture.generator, {
    random: createRandom(deriveSeed(seed, "texture")),
    width,
    height,
    cellSize: Math.max(1, texture.scale * BASE_CELL * height),
  });
  const table = paletteTable(texture.palette);
  const top = PALETTE_LEVELS - 1;
  return (x, y) => table[Math.min(top, Math.floor(values(x, y) * PALETTE_LEVELS))];
}
