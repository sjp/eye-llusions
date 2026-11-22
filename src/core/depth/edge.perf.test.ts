import { expect, test } from "vitest";
import { edgeDepth } from "./edge.ts";

test("applies a rounded edge to a 2000×1200 mask well within a frame budget", () => {
  const width = 2000;
  const height = 1200;
  const coverage = new Float32Array(width * height);
  // Vertical bars, like a line of heavy lettering.
  for (let y = 200; y < 1000; y++) {
    for (let x = 100; x < 1900; x++) {
      coverage[y * width + x] = x % 160 < 100 ? 1 : 0;
    }
  }
  const depth = new Float32Array(width * height);
  const run = () => {
    edgeDepth(coverage, width, height, "round", 60, depth);
  };
  run();
  const times: number[] = [];
  for (let attempt = 0; attempt < 5; attempt++) {
    const start = performance.now();
    run();
    times.push(performance.now() - start);
  }
  const median = times.toSorted((a, b) => a - b)[2];
  expect(median, `median ${median.toFixed(1)} ms`).toBeLessThan(250);
});
