import { expect, test } from "@playwright/test";
import { openLayers as open, renders, settledPixels } from "./preview.ts";

test("switching pattern and palette changes the preview, and undo restores it", async ({
  page,
}) => {
  const { canvas, violations, errors } = await open(page);
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
  expect(violations).toEqual([]);
  expect(errors).toEqual([]);
});

test("the pattern settings follow the chosen generator", async ({ page }) => {
  const { errors } = await open(page);
  await expect(page.getByRole("slider", { name: "Dot density" })).toBeVisible();
  await page.getByRole("radio", { name: "Marble" }).check();
  await expect(page.getByRole("slider", { name: "Detail" })).toBeVisible();
  await expect(page.getByRole("slider", { name: "Dot density" })).toHaveCount(0);
  await page.getByRole("radio", { name: "Cells" }).check();
  await expect(page.getByRole("slider", { name: "Edge shading" })).toBeVisible();
  await page.getByRole("radio", { name: "Noise" }).check();
  await expect(page.getByRole("slider", { name: "Edge shading" })).toHaveCount(0);
  expect(errors).toEqual([]);
});
