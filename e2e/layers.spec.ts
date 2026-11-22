import { expect, test } from "@playwright/test";
import { layerNames as names, openLayers as open, renders, settledPixels } from "./preview.ts";

test("adding, hiding and deleting a shape changes the depth map and back", async ({ page }) => {
  const { canvas, list, violations, errors } = await open(page);
  let count = await renders(canvas);
  await page.getByRole("radio", { name: "Depth" }).click();
  const original = await settledPixels(canvas, count);

  count = await renders(canvas);
  await page.getByRole("button", { name: "Add shape" }).click();
  await expect(names(list)).toHaveText(["Sphere 2", "Sphere"]);
  // A smaller sphere inside the first changes nothing yet.
  expect(await settledPixels(canvas, count)).toBe(original);

  count = await renders(canvas);
  await page.getByRole("slider", { name: "X position" }).fill("0.3");
  const moved = await settledPixels(canvas, count);

  count = await renders(canvas);
  await page.getByRole("radio", { name: "Pyramid" }).check();
  await expect(page.getByRole("slider", { name: "Sides" })).toBeVisible();
  const pyramid = await settledPixels(canvas, count);

  count = await renders(canvas);
  await page.getByRole("combobox", { name: "Blend" }).selectOption({ label: "Replace" });
  const scene = await settledPixels(canvas, count);
  expect(new Set([original, moved, pyramid, scene]).size).toBe(4);

  count = await renders(canvas);
  await page.getByRole("checkbox", { name: "Show Sphere 2" }).uncheck();
  expect(await settledPixels(canvas, count)).toBe(original);

  count = await renders(canvas);
  await page.getByRole("checkbox", { name: "Show Sphere 2" }).check();
  expect(await settledPixels(canvas, count)).toBe(scene);

  count = await renders(canvas);
  await page.getByRole("button", { name: "Delete" }).click();
  await expect(names(list)).toHaveText(["Sphere"]);
  expect(await settledPixels(canvas, count)).toBe(original);

  count = await renders(canvas);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(names(list)).toHaveText(["Sphere 2", "Sphere"]);
  expect(await settledPixels(canvas, count)).toBe(scene);

  // The stereogram view shows the same scene.
  count = await renders(canvas);
  await page.getByRole("radio", { name: "Stereogram" }).click();
  await settledPixels(canvas, count);
  await expect(canvas).toHaveAttribute("data-output", "stereogram");
  expect(violations).toEqual([]);
  expect(errors).toEqual([]);
});

test("the move buttons reorder layers and undo", async ({ page }) => {
  const { list, errors } = await open(page);
  await page.getByRole("button", { name: "Add shape" }).click();
  await page.getByRole("button", { name: "Add shape" }).click();
  await expect(names(list)).toHaveText(["Sphere 3", "Sphere 2", "Sphere"]);
  await expect(page.getByRole("button", { name: "Move Sphere 3 up" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Move Sphere down" })).toBeDisabled();

  await page.getByRole("button", { name: "Move Sphere 3 down" }).click();
  await page.getByRole("button", { name: "Move Sphere 3 down" }).click();
  await expect(names(list)).toHaveText(["Sphere 2", "Sphere", "Sphere 3"]);
  await page.getByRole("button", { name: "Move Sphere up" }).click();
  await expect(names(list)).toHaveText(["Sphere", "Sphere 2", "Sphere 3"]);

  await page.getByRole("button", { name: "Undo" }).click();
  await expect(names(list)).toHaveText(["Sphere 2", "Sphere", "Sphere 3"]);
  expect(errors).toEqual([]);
});

test("layers reorder by dragging on desktop", async ({ page, isMobile }) => {
  test.skip(isMobile, "Phones reorder with the move buttons");
  const { list, errors } = await open(page);
  await page.getByRole("button", { name: "Add shape" }).click();
  await page.getByRole("button", { name: "Add shape" }).click();
  await expect(names(list)).toHaveText(["Sphere 3", "Sphere 2", "Sphere"]);

  const rows = list.getByRole("listitem");
  await rows.nth(0).dragTo(rows.nth(2));
  await expect(names(list)).toHaveText(["Sphere 2", "Sphere", "Sphere 3"]);
  await rows.nth(2).dragTo(rows.nth(1));
  await expect(names(list)).toHaveText(["Sphere 2", "Sphere 3", "Sphere"]);

  await page.keyboard.press("ControlOrMeta+z");
  await expect(names(list)).toHaveText(["Sphere 2", "Sphere", "Sphere 3"]);
  expect(errors).toEqual([]);
});
