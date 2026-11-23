import { expect, test } from "vitest";
import { CORE_RASTERISERS } from "../core/depth/composite.ts";
import { createRandom } from "../core/random.ts";
import { defaultRecipe, type Brush, type Recipe, type Stroke } from "../core/recipe.ts";
import { createDepthCache, renderPixels } from "./pipeline.ts";

const MODES: Brush["mode"][] = ["set", "raise", "lower", "smooth"];

/** A sphere under a drawing of 100 strokes of 200 points, 20 000 points in all. */
function heavyRecipe(): Recipe {
  const random = createRandom(3);
  const strokes = Array.from({ length: 100 }, (_, i): Stroke => {
    let x = random.float();
    let y = random.float();
    const points: number[] = [];
    for (let p = 0; p < 200; p++) {
      x += (random.float() - 0.5) * 0.02;
      y += (random.float() - 0.5) * 0.02;
      points.push(x, y);
    }
    const brush = {
      size: 0.03 + 0.05 * random.float(),
      softness: random.float(),
      mode: MODES[i % 4],
      value: 0.6,
    };
    return { brush, points };
  });
  const base = defaultRecipe();
  return {
    ...base,
    aspect: 1170 / 1500,
    layers: [
      ...base.layers,
      {
        kind: "drawing",
        id: "drawing",
        name: "Drawing",
        visible: true,
        blend: "max",
        depth: 1,
        strokes,
      },
    ],
  };
}

async function median(run: (index: number) => Promise<unknown>): Promise<number> {
  const times: number[] = [];
  for (let index = 0; index < 5; index++) {
    const start = performance.now();
    await run(index);
    times.push(performance.now() - start);
  }
  return times.toSorted((a, b) => a - b)[2];
}

test("a view-only change to a heavy drawing at 1170×1500 is at least 5× faster than a full render", async () => {
  const recipe = heavyRecipe();
  const request = { width: 1170, height: 1500, oversample: 1, output: "stereogram" as const };
  const out = new Uint8ClampedArray(1170 * 1500 * 4);
  const cache = createDepthCache();
  const render = (next: Recipe) =>
    renderPixels(next, request, CORE_RASTERISERS, out, undefined, cache.composite);
  const withRepeats = (index: number): Recipe => ({
    ...recipe,
    view: { ...recipe.view, repeats: 6 + index },
  });

  await render(recipe);
  const full = await median(async () => {
    cache.assetsChanged();
    await render(recipe);
  });
  const viewOnly = await median((index) => render(withRepeats(index)));
  expect(
    full / viewOnly,
    `full ${full.toFixed(1)} ms, view only ${viewOnly.toFixed(1)} ms`,
  ).toBeGreaterThanOrEqual(5);
});
