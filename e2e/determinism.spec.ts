import type { Asset, Recipe, TextureGenerator } from "../src/core/recipe.ts";
import { expect, test } from "./guard.ts";
import { renderInWorker, workerUrl } from "./worker.ts";

const WIDTH = 240;
const HEIGHT = 135;

/** A small grey ramp for the tile generator. */
const TILE: Asset = {
  format: "gray",
  width: 4,
  height: 4,
  data: Uint8Array.from({ length: 16 }, (_, i) => i * 17),
};

const GENERATORS: Record<TextureGenerator["type"], TextureGenerator> = {
  randomDots: { type: "randomDots", density: 0.5 },
  colourNoise: { type: "colourNoise" },
  fractalNoise: { type: "fractalNoise", octaves: 4 },
  cells: { type: "cells", shading: 0.6 },
  scatteredShapes: { type: "scatteredShapes", density: 0.5 },
  tile: { type: "tile", asset: "tile", divisions: 2, jitter: 0.3 },
};

function recipe(generator: TextureGenerator, mode: "wall" | "cross" = "wall"): Recipe {
  return {
    version: 1,
    aspect: WIDTH / HEIGHT,
    seed: 1234,
    layers: [
      {
        kind: "sample",
        id: "torus",
        name: "Torus",
        visible: true,
        blend: "max",
        depth: 1,
        shape: { type: "torus", thickness: 0.4 },
        center: { x: 0.5, y: 0.5 },
        size: 0.7,
      },
    ],
    texture: { generator, palette: { type: "preset", id: "neon" }, scale: 1, seed: 5 },
    view: { repeats: 6, depthOfField: 1 / 3, mode },
    assets: generator.type === "tile" ? { tile: TILE } : {},
  };
}

/** One render of each generator, and one cross-eyed. */
const CASES: Record<string, Recipe> = {
  ...Object.fromEntries(
    Object.entries(GENERATORS).map(([name, generator]) => [name, recipe(generator)]),
  ),
  crossEyed: recipe(GENERATORS.randomDots, "cross"),
};

/**
 * Pixel hashes of each case, rendered at 240 × 135 with 2× oversampling. Browsers'
 * maths functions may round differently; these hold in Chromium, Firefox and WebKit.
 */
const EXPECTED: Record<string, string> = {
  randomDots: "f756a6ec",
  colourNoise: "48d8fb96",
  fractalNoise: "d5352d5c",
  cells: "0f4727fb",
  scatteredShapes: "92facec2",
  tile: "55a23e77",
  crossEyed: "17e653ac",
};

/** FNV-1a over the bytes. */
function hash(bytes: number[]): string {
  let h = 0x811c9dc5;
  for (const byte of bytes) {
    h = Math.imul(h ^ byte, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

test("every generator renders the same pixels in every browser", async ({ page }) => {
  await page.goto("./");
  const url = await workerUrl(page);
  const hashes: Record<string, string> = {};
  for (const [name, scene] of Object.entries(CASES)) {
    const pixels = await renderInWorker(page, url, {
      recipe: scene,
      width: WIDTH,
      height: HEIGHT,
      oversample: 2,
      output: "stereogram",
    });
    hashes[name] = hash(pixels);
  }
  expect(hashes).toEqual(EXPECTED);
});
