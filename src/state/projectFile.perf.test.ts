import { expect, test } from "vitest";
import { writeChunks } from "../core/png/chunks.ts";
import { createRandom } from "../core/random.ts";
import { defaultRecipe, type Recipe } from "../core/recipe.ts";
import { compress } from "./bytes.ts";
import { embedProject, readProject } from "./projectFile.ts";

const SIDE = 2048;

/** A tiled texture whose 2048 × 2048 colour image, 16 MB, is noise that won't compress. */
function heavyRecipe(): Recipe {
  const random = createRandom(5);
  const data = new Uint8Array(SIDE * SIDE * 4);
  const words = new Uint32Array(data.buffer);
  for (let i = 0; i < words.length; i++) {
    words[i] = random.uint32();
  }
  const base = defaultRecipe();
  return {
    ...base,
    texture: {
      ...base.texture,
      generator: { type: "tile", asset: "tile", divisions: 1, jitter: 0 },
    },
    assets: { tile: { format: "rgba", width: SIDE, height: SIDE, data } },
  };
}

function tinyPng(): Uint8Array<ArrayBuffer> {
  const header = Uint8Array.of(0, 0, 0, 2, 0, 0, 0, 1, 8, 2, 0, 0, 0);
  return writeChunks([
    { type: "IHDR", data: header },
    { type: "IDAT", data: Uint8Array.of(120, 156, 99, 248, 207, 0, 4, 255, 1, 7, 0, 1, 255) },
    { type: "IEND", data: new Uint8Array() },
  ]);
}

async function median(run: () => Promise<unknown>): Promise<number> {
  const times: number[] = [];
  for (let index = 0; index < 5; index++) {
    const start = performance.now();
    await run();
    times.push(performance.now() - start);
  }
  return times.toSorted((a, b) => a - b)[2];
}

// Deflating the pixels is work any compact file needs, and on its own takes over 200 ms
// for 16 MB, so embedding is measured by what it adds to that.
test("16 MB of assets embed in little more than it takes to deflate them, and read in well under 200 ms", async () => {
  const recipe = heavyRecipe();
  const png = tinyPng();
  const pixels = recipe.assets.tile.data;
  let file = await embedProject(png, recipe);
  const deflate = await median(() => compress(new Uint8Array(pixels), "deflate-raw"));
  const embed = await median(async () => {
    file = await embedProject(png, recipe);
  });
  const read = await median(() => readProject(file));
  expect(embed - deflate).toBeLessThan(100);
  expect(read).toBeLessThan(150);
}, 60_000);
