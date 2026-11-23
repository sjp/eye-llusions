import { expect, test } from "./guard.ts";
import { openLayers as open, renders, settledPixels } from "./preview.ts";

test("switching pattern and palette changes the preview, and undo restores it", async ({
  page,
}) => {
  const { canvas } = await open(page);
  const original = await settledPixels(canvas, (await renders(canvas)) - 1);

  const seen = new Set([original]);
  for (const pattern of ["Marble", "Cells", "Shapes", "Noise"]) {
    const count = await renders(canvas);
    await page.getByRole("radio", { name: pattern }).check();
    seen.add(await settledPixels(canvas, count));
  }
  expect(seen.size).toBe(5);

  let count = await renders(canvas);
  await page.getByRole("radio", { name: "Ocean" }).check();
  const ocean = await settledPixels(canvas, count);
  expect(seen.has(ocean)).toBe(false);

  count = await renders(canvas);
  await page.getByRole("button", { name: "New texture seed" }).click();
  const reseeded = await settledPixels(canvas, count);
  expect(reseeded).not.toBe(ocean);

  count = await renders(canvas);
  await page.getByRole("slider", { name: "Scale" }).fill("1");
  const scaled = await settledPixels(canvas, count);
  expect(scaled).not.toBe(reseeded);

  for (let step = 0; step < 7; step++) {
    await page.getByRole("button", { name: "Undo" }).click();
  }
  await expect(page.getByRole("button", { name: "Undo" })).toBeDisabled();
  await expect(page.getByRole("radio", { name: "Dots" })).toBeChecked();
  await expect(page.getByRole("radio", { name: "Mono" })).toBeChecked();
  expect(await settledPixels(canvas, (await renders(canvas)) - 1)).toBe(original);
});

test("the pattern settings follow the chosen generator", async ({ page }) => {
  await open(page);
  await expect(page.getByRole("slider", { name: "Dot density" })).toBeVisible();
  await page.getByRole("radio", { name: "Marble" }).check();
  await expect(page.getByRole("slider", { name: "Detail" })).toBeVisible();
  await expect(page.getByRole("slider", { name: "Dot density" })).toHaveCount(0);
  await page.getByRole("radio", { name: "Cells" }).check();
  await expect(page.getByRole("slider", { name: "Edge shading" })).toBeVisible();
  await page.getByRole("radio", { name: "Noise" }).check();
  await expect(page.getByRole("slider", { name: "Edge shading" })).toHaveCount(0);
});

const HALF_SKY = new URL("fixtures/half-sky.png", import.meta.url);

test("an uploaded tile changes the preview, warns about flat areas and takes jitter", async ({
  page,
}) => {
  const { canvas } = await open(page);
  const original = await settledPixels(canvas, (await renders(canvas)) - 1);

  await page.getByRole("radio", { name: "Tile" }).check();
  await expect(page.getByText("Tile missing")).toBeVisible();
  await expect(page.getByRole("radio", { name: "Mono" })).toHaveCount(0);

  let count = await renders(canvas);
  await page.getByLabel("Tile image").setInputFiles(HALF_SKY.pathname);
  await expect(page.getByRole("button", { name: "Replace tile" })).toBeVisible();
  await expect(page.getByText(/Large parts of this tile are flat/)).toBeVisible();
  const tiled = await settledPixels(canvas, count);
  expect(tiled).not.toBe(original);

  count = await renders(canvas);
  await page.getByRole("slider", { name: "Jitter" }).fill("0.5");
  await expect(page.getByText(/Large parts of this tile are flat/)).toHaveCount(0);
  const jittered = await settledPixels(canvas, count);
  expect(jittered).not.toBe(tiled);

  count = await renders(canvas);
  await page.getByRole("radio", { name: "1/2" }).check();
  expect(await settledPixels(canvas, count)).not.toBe(jittered);
});

test("a custom palette with colours of equal brightness shows a warning", async ({ page }) => {
  const { canvas } = await open(page);
  await page.getByRole("radio", { name: "Custom" }).check();
  await expect(page.getByLabel("Colour 1", { exact: true })).toHaveValue("#000000");
  await expect(page.getByText(/too similar in brightness/)).toHaveCount(0);

  const count = await renders(canvas);
  await page.getByLabel("Colour 1", { exact: true }).fill("#ff0000");
  await page.getByLabel("Colour 2", { exact: true }).fill("#7f7f7f");
  await expect(page.getByText(/too similar in brightness/)).toBeVisible();
  await settledPixels(canvas, count);
});
