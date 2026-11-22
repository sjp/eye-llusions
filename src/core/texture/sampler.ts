import { createRandom, deriveSeed } from "../random.ts";
import type { Recipe } from "../recipe.ts";
import { createGenerator, type ValueGenerator } from "./generators.ts";
import { PALETTE_LEVELS, paletteTable } from "./palette.ts";
import { BASE_CELL } from "./scale.ts";
import { tileSampler } from "./tile.ts";

/** Shown in place of a tile whose image the recipe doesn't hold. */
const MISSING_TILE: ValueGenerator = { type: "randomDots", density: 0.5 };

/**
 * The texture's colour at output pixel `(x, y)`, packed as `0xRRGGBBAA`, in the form
 * the stereogram renderer's `sample` option takes.
 */
export function buildSampler(
  recipe: Pick<Recipe, "texture" | "seed" | "view" | "assets">,
  width: number,
  height: number,
): (x: number, y: number) => number {
  const { texture } = recipe;
  const random = createRandom((deriveSeed(recipe.seed, "texture") ^ texture.seed) >>> 0);
  let generator: ValueGenerator;
  if (texture.generator.type === "tile") {
    const { asset, divisions, jitter } = texture.generator;
    if (Object.hasOwn(recipe.assets, asset)) {
      return tileSampler(recipe.assets[asset], {
        strip: width / recipe.view.repeats,
        divisions,
        jitter,
        height,
        noiseCell: Math.max(1, BASE_CELL * height),
        random,
      });
    }
    generator = MISSING_TILE;
  } else {
    generator = texture.generator;
  }
  const values = createGenerator(generator, {
    random,
    width,
    height,
    cellSize: Math.max(1, texture.scale * BASE_CELL * height),
  });
  const table = paletteTable(texture.palette);
  const top = PALETTE_LEVELS - 1;
  return (x, y) => table[Math.min(top, Math.floor(values(x, y) * PALETTE_LEVELS))];
}
