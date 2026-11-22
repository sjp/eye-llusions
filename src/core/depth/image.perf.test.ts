import { expect, test } from "vitest";
import { createRandom } from "../random.ts";
import { defaultRecipe, type ImageLayer } from "../recipe.ts";
import { compositeDepth } from "./composite.ts";

test("rasterises a blurred, posterized image at 2000×1200 within a frame budget", async () => {
  const random = createRandom(13);
  const data = new Uint8Array(1024 * 768);
  for (let i = 0; i < data.length; i++) {
    data[i] = random.uint32() & 0xff;
  }
  const layer: ImageLayer = {
    kind: "image",
    id: "image",
    name: "Image",
    visible: true,
    blend: "max",
    depth: 1,
    asset: "photo",
    fit: "cover",
    invert: true,
    levels: { black: 0.1, white: 0.9 },
    blur: 0.02,
    posterize: 8,
    threshold: null,
  };
  const recipe = {
    ...defaultRecipe(),
    layers: [layer],
    assets: { photo: { format: "gray" as const, width: 1024, height: 768, data } },
  };
  const render = () => compositeDepth(recipe, 2000, 1200);

  await render();
  const times: number[] = [];
  for (let run = 0; run < 5; run++) {
    const start = performance.now();
    await render();
    times.push(performance.now() - start);
  }
  const median = times.toSorted((a, b) => a - b)[2];
  expect(median, `median ${median.toFixed(1)} ms`).toBeLessThan(300);
});
