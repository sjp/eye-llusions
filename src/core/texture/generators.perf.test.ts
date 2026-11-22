import { expect, test } from "vitest";
import { defaultRecipe } from "../recipe.ts";
import type { ValueGenerator } from "./generators.ts";
import { buildSampler } from "./sampler.ts";

const WIDTH = 2000;
const HEIGHT = 1200;

/** The samples a 2000×1200 stereogram at 8 repeats takes: one strip's worth per row. */
const SAMPLES = (WIDTH / 8) * HEIGHT;

test.each<ValueGenerator>([
  { type: "fractalNoise", octaves: 6 },
  { type: "cells", shading: 0.5 },
  { type: "scatteredShapes", density: 1 },
])("$type samples a large stereogram's texture quickly", (generator) => {
  const sample = buildSampler(
    {
      ...defaultRecipe(),
      seed: 1,
      texture: { generator, palette: { type: "preset", id: "ocean" }, scale: 1, seed: 0 },
    },
    WIDTH,
    HEIGHT,
  );
  const strip = WIDTH / 8;
  let checksum = 0;
  const run = () => {
    for (let i = 0; i < SAMPLES; i++) {
      checksum ^= sample(i % strip, Math.floor(i / strip));
    }
  };
  run();
  const times: number[] = [];
  for (let round = 0; round < 5; round++) {
    const start = performance.now();
    run();
    times.push(performance.now() - start);
  }
  const median = times.toSorted((a, b) => a - b)[2];
  expect(checksum).toBeTypeOf("number");
  expect(median, `median ${median.toFixed(1)} ms`).toBeLessThan(150);
});
