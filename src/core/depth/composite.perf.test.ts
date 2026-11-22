import { expect, test } from "vitest";
import { defaultRecipe, type SampleLayer, type SampleShape } from "../recipe.ts";
import { compositeDepth } from "./composite.ts";

const SHAPES: SampleShape[] = [
  { type: "sphere" },
  { type: "ripples", rings: 6 },
  { type: "pyramid", sides: 5 },
  { type: "torus", thickness: 0.3 },
  { type: "spiralStairs", steps: 24, turns: 3 },
];

test("composites eight large layers at 2000×1200 well within a frame budget", async () => {
  const layers = Array.from({ length: 8 }, (_, i): SampleLayer => ({
    kind: "sample",
    id: `layer${String(i)}`,
    name: "Layer",
    visible: true,
    blend: i % 2 === 0 ? "max" : "add",
    depth: 0.8,
    shape: SHAPES[i % SHAPES.length],
    center: { x: 0.2 + 0.08 * i, y: 0.5 },
    size: 0.9,
  }));
  const recipe = { ...defaultRecipe(), layers };
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
