import { chromium, devices, webkit, type Page } from "@playwright/test";
import { expect, test, watchContext } from "./guard.ts";
import { readdirSync } from "node:fs";
import { layerNames, openLayers, renders, settledPixels } from "./preview.ts";

test("a text layer types live, undoes per burst and has distinct edge profiles", async ({
  page,
}) => {
  const { canvas, list } = await openLayers(page);
  let count = await renders(canvas);
  await page.getByRole("radio", { name: "Depth" }).click();
  const sphere = await settledPixels(canvas, count);

  count = await renders(canvas);
  await page.getByRole("button", { name: "Add text" }).click();
  await expect(layerNames(list)).toHaveText(["Text", "Sphere"]);
  const hello = await settledPixels(canvas, count);
  expect(hello).not.toBe(sphere);

  const text = page.getByRole("textbox", { name: "Text" });
  count = await renders(canvas);
  await text.press("End");
  await text.pressSequentially("\nWORLD");
  const twoLines = await settledPixels(canvas, count);
  expect(twoLines).not.toBe(hello);

  const profiles = new Set([twoLines]);
  for (const edge of ["Flat", "Bevel"]) {
    count = await renders(canvas);
    await page.getByRole("radio", { name: edge }).check();
    profiles.add(await settledPixels(canvas, count));
  }
  expect(profiles.size).toBe(3);

  // Undo the two edge changes, then the whole typing burst in one step.
  for (let step = 0; step < 2; step++) {
    await page.getByRole("button", { name: "Undo" }).click();
  }
  await expect(page.getByRole("radio", { name: "Round" })).toBeChecked();
  count = await renders(canvas);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(text).toHaveValue("HELLO");
  expect(await settledPixels(canvas, count)).toBe(hello);

  await page.getByRole("combobox", { name: "Font" }).selectOption({ label: "Alfa Slab One" });
  await expect(page.getByRole("link", { name: /Font licence/ })).toHaveAttribute(
    "href",
    /OFL.*\.txt$/,
  );
});

test.describe(() => {
  // The aborted font requests log console errors.
  test.use({ consoleErrors: "allow" });

  test("a font that fails to load shows an error until it loads", async ({ page, context }) => {
    const { canvas } = await openLayers(page);
    await context.route("**/*.woff2", (route) => route.abort());
    await page.getByRole("button", { name: "Add text" }).click();
    const alert = page.getByRole("alert");
    await expect(alert).toContainText("the font Anton couldn't be loaded");

    await context.unrouteAll();
    const count = await renders(canvas);
    await page.getByRole("slider", { name: "Size" }).fill("0.4");
    await expect(alert).toBeHidden();
    await settledPixels(canvas, count);
  });
});

const TEXT_RECIPE = {
  version: 1,
  aspect: 16 / 9,
  seed: 1,
  layers: [
    ["Anton", "anton", "flat", 0.25],
    ["Wide", "archivo-black", "bevel", 0.72],
    ["Slab\nTwo", "alfa-slab-one", "round", 0.6],
  ].map(([text, font, edge, x], index) => ({
    kind: "text",
    id: `text-${String(index)}`,
    name: "Text",
    visible: true,
    blend: "max",
    depth: 1 - index * 0.2,
    text,
    font,
    size: 0.22,
    center: { x, y: index === 2 ? 0.7 : 0.25 },
    edge,
    edgeWidth: 0.04,
  })),
  texture: {
    generator: { type: "randomDots", density: 0.5 },
    palette: { type: "preset", id: "mono" },
    scale: 1,
    seed: 0,
  },
  view: { repeats: 8, depthOfField: 1 / 3, mode: "wall" },
  assets: {},
};

const WIDTH = 480;
const HEIGHT = 270;

/** Renders the recipe's depth map at a fixed size in the app's own worker. */
async function renderDepth(page: Page, workerUrl: string): Promise<number[]> {
  await page.goto("./");
  const depth = await page.evaluate(
    async ([url, recipe, width, height]) => {
      const worker = new Worker(url, { type: "module" });
      const reply = await new Promise<MessageEvent>((resolve, reject) => {
        worker.addEventListener("message", resolve);
        worker.addEventListener("error", () => {
          reject(new Error("worker failed"));
        });
        worker.postMessage(
          {
            requestId: 1,
            recipe,
            width,
            height,
            oversample: 1,
            output: "depth",
            assets: {},
            assetIds: [],
          },
          [],
        );
      });
      worker.terminate();
      const response: unknown = reply.data;
      if (typeof response !== "object" || response === null || !("image" in response)) {
        throw new Error(JSON.stringify(response));
      }
      const image = response.image;
      const context = new OffscreenCanvas(width, height).getContext("2d");
      if (context === null) {
        throw new Error("No 2D context");
      }
      if (image instanceof ImageData) {
        context.putImageData(image, 0, 0);
      } else if (image instanceof ImageBitmap) {
        context.drawImage(image, 0, 0);
      }
      const { data } = context.getImageData(0, 0, width, height);
      return Array.from(data.filter((_, i) => i % 4 === 0));
    },
    [workerUrl, TEXT_RECIPE, WIDTH, HEIGHT] as const,
  );
  return depth;
}

test("text renders the same in desktop and mobile browsers", async ({ page }, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop-chromium",
    "Compares every browser from one project",
  );
  const worker = readdirSync("dist-e2e/assets").find((name) => /^worker-.*\.js$/.test(name));
  expect(worker).toBeDefined();
  const workerUrl = `assets/${String(worker)}`;
  const reference = await renderDepth(page, workerUrl);
  const covered = reference.filter((value) => value > 0).length;
  expect(covered).toBeGreaterThan(WIDTH * HEIGHT * 0.05);

  for (const [engine, device] of [
    [chromium, devices["Pixel 7"]],
    [webkit, devices["iPhone 15"]],
  ] as const) {
    const browser = await engine.launch();
    try {
      const context = await browser.newContext({ ...device, baseURL: page.url() });
      const watched = await watchContext(context);
      const depth = await renderDepth(await context.newPage(), workerUrl);
      expect(watched.violations).toEqual([]);
      expect(watched.errors).toEqual([]);
      let total = 0;
      let largest = 0;
      for (let i = 0; i < depth.length; i++) {
        const difference = Math.abs(depth[i] - reference[i]);
        total += difference;
        largest = Math.max(largest, difference);
      }
      const mean = total / depth.length;
      const summary = `mean difference ${mean.toFixed(3)}, largest ${String(largest)}`;
      if (engine === chromium) {
        expect(largest, summary).toBe(0);
      } else {
        // WebKit anti-aliases glyph outlines slightly differently.
        expect(mean, summary).toBeLessThan(1);
        expect(largest, summary).toBeLessThanOrEqual(64);
      }
    } finally {
      await browser.close();
    }
  }
});
