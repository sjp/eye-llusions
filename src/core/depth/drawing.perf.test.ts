import { expect, test } from "vitest";
import { createRandom } from "../random.ts";
import { defaultRecipe, type Brush, type DrawingLayer, type Stroke } from "../recipe.ts";
import { compositeDepth } from "./composite.ts";

const MODES: Brush["mode"][] = ["set", "raise", "lower", "smooth"];

test("rasterises a busy drawing at 2000×1200 within a frame budget", async () => {
  const random = createRandom(7);
  // 200 wandering strokes of 50 points each, about 10 000 points in all.
  const strokes = Array.from({ length: 200 }, (_, i): Stroke => {
    let x = random.float();
    let y = random.float();
    const points: number[] = [];
    for (let p = 0; p < 50; p++) {
      x += (random.float() - 0.5) * 0.04;
      y += (random.float() - 0.5) * 0.04;
      points.push(x, y);
    }
    return {
      brush: {
        size: 0.02 + 0.06 * random.float(),
        softness: random.float(),
        mode: MODES[i % 4],
        value: 0.5,
      },
      points,
    };
  });
  const layer: DrawingLayer = {
    kind: "drawing",
    id: "drawing",
    name: "Drawing",
    visible: true,
    blend: "max",
    depth: 1,
    strokes,
  };
  const recipe = { ...defaultRecipe(), layers: [layer] };
  const render = () => compositeDepth(recipe, 2000, 1200);

  await render();
  const times: number[] = [];
  for (let run = 0; run < 5; run++) {
    const start = performance.now();
    await render();
    times.push(performance.now() - start);
  }
  const median = times.toSorted((a, b) => a - b)[2];
  expect(median, `median ${median.toFixed(1)} ms`).toBeLessThan(500);
});
