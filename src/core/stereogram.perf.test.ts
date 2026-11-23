import { expect, test } from "vitest";
import { renderStereogram } from "./stereogram.ts";

const WIDTH = 2000;
const HEIGHT = 1200;

function sceneDepth(): Float32Array {
  const depth = new Float32Array(WIDTH * HEIGHT);
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const dx = (x - WIDTH / 2) / (HEIGHT / 3);
      const dy = (y - HEIGHT / 2) / (HEIGHT / 3);
      const dome = 1 - dx * dx - dy * dy;
      const square = x > 200 && x < 600 && y > 200 && y < 600 ? 0.8 : 0;
      depth[y * WIDTH + x] = Math.max(dome, square, 0);
    }
  }
  return depth;
}

test("renders a 2000×1200 stereogram well within a frame budget", () => {
  const depth = sceneDepth();
  const out = new Uint8ClampedArray(WIDTH * HEIGHT * 4);
  const render = () =>
    renderStereogram({
      depth,
      width: WIDTH,
      height: HEIGHT,
      repeats: 8,
      depthOfField: 1 / 3,
      mode: "wall",
      oversample: 1,
      sample: (x, y) =>
        ((Math.imul(Math.floor(x), 0x9e3779b1) ^ Math.imul(y, 0x85ebca6b)) | 0xff) >>> 0,
      out,
    });

  render();
  const times: number[] = [];
  for (let run = 0; run < 5; run++) {
    const start = performance.now();
    render();
    times.push(performance.now() - start);
  }
  const median = times.toSorted((a, b) => a - b)[2];
  expect(median, `median ${median.toFixed(1)} ms`).toBeLessThan(300);
});

test("renders a 3840×2160 near speck on every row, at a deep field, within a budget", () => {
  const width = 3840;
  const height = 2160;
  const depth = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    depth[y * width + (((y * 2654435761) >>> 0) % width)] = 1;
  }
  const out = new Uint8ClampedArray(width * height * 4);
  const times: number[] = [];
  for (const [mode, repeats, depthOfField] of [
    ["wall", 2, 0.9],
    ["wall", 8, 0.9],
    ["cross", 3, 0.5],
  ] as const) {
    const start = performance.now();
    renderStereogram({
      depth,
      width,
      height,
      repeats,
      depthOfField,
      mode,
      oversample: 1,
      sample: (x, y) => ((Math.imul(Math.floor(x), 0x9e3779b1) ^ y) | 0xff) >>> 0,
      out,
    });
    times.push(performance.now() - start);
  }
  const slowest = Math.max(...times);
  expect(slowest, `slowest ${slowest.toFixed(1)} ms`).toBeLessThan(600);
});
