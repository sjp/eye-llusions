import { expect, test } from "vitest";
import { createRandom } from "../random.ts";
import { RECIPE_LIMITS, parseRecipe } from "../parseRecipe.ts";
import {
  defaultRecipe,
  type Brush,
  type DrawingLayer,
  type Recipe,
  type Stroke,
} from "../recipe.ts";
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

/**
 * The recipe with the most points the parser accepts, drawn with `brush` in strokes of
 * up to `pointsPerStroke` points that zigzag from corner to corner of the canvas.
 */
function atLimit(brush: Brush, pointsPerStroke: number): Recipe {
  const make = (points: number): Recipe => {
    const strokes: Stroke[] = [];
    for (let left = points; left > 0; left -= pointsPerStroke) {
      const count = Math.min(left, pointsPerStroke);
      strokes.push({
        brush,
        points: Array.from({ length: count * 2 }, (_, i) => Math.floor(i / 2) % 2),
      });
    }
    return {
      ...defaultRecipe(),
      layers: [
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
  };
  const fits = (points: number): boolean => {
    try {
      parseRecipe(make(points));
      return true;
    } catch {
      return false;
    }
  };
  let low = 1;
  let high = RECIPE_LIMITS.pointsTotal;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (fits(middle)) {
      low = middle;
    } else {
      high = middle - 1;
    }
  }
  return make(low);
}

async function medianTime(render: () => Promise<unknown>): Promise<number> {
  await render();
  const times: number[] = [];
  for (let run = 0; run < 5; run++) {
    const start = performance.now();
    await render();
    times.push(performance.now() - start);
  }
  return times.toSorted((a, b) => a - b)[2];
}

test.each<[string, Brush, number]>([
  ["a fine zigzag", { size: 0.001, softness: 0, mode: "set", value: 1 }, 4000],
  ["a wide zigzag", { size: 0.3, softness: 0.5, mode: "raise", value: 0.5 }, 4000],
  ["a full-canvas brush", { size: 1, softness: 1, mode: "set", value: 1 }, 4000],
  ["smoothing across the canvas", { size: 0.01, softness: 0, mode: "smooth", value: 1 }, 2],
])(
  "rasterises the costliest drawing the parser accepts, %s, at 1066×600 in time",
  async (_, brush, pointsPerStroke) => {
    const recipe = atLimit(brush, pointsPerStroke);
    const median = await medianTime(() => compositeDepth(recipe, 1066, 600));
    expect(median, `median ${median.toFixed(1)} ms`).toBeLessThan(500);
  },
);
