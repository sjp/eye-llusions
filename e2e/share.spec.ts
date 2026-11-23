import { expect, test } from "@playwright/test";
import { layerNames, openLayers, settledPixels } from "./preview.ts";

test("a copied link opens the same scene in a new page", async ({ page, context, browserName }) => {
  if (browserName === "chromium") {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  }
  const { canvas, list, violations, errors } = await openLayers(page);
  await page.getByRole("button", { name: "Add text" }).click();
  await page.getByRole("button", { name: "Add drawing" }).click();
  await expect(layerNames(list)).toHaveText(["Drawing", "Text", "Sphere"]);
  await page.getByRole("radio", { name: "Draw" }).check();
  const surface = page.getByLabel("Drawing surface");
  const box = await surface.boundingBox();
  if (box === null) {
    throw new Error("The drawing surface isn't visible");
  }
  await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.3);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.2, { steps: 8 });
  await page.mouse.move(box.x + box.width * 0.8, box.y + box.height * 0.4, { steps: 8 });
  await page.mouse.up();
  await expect(surface).toHaveAttribute("data-strokes", "1");
  await expect(page.getByRole("radio", { name: "Depth" })).toBeChecked();
  const depth = await settledPixels(canvas, 0);

  await page.getByRole("button", { name: "Share" }).click();
  const dialog = page.getByRole("dialog", { name: "Share" });
  const link = await dialog.getByRole("textbox", { name: "Link" }).inputValue();
  expect(link).toMatch(/#r=1\.[\w-]+$/);
  await expect(dialog).not.toContainText("Images can't travel");
  await dialog.getByRole("button", { name: "Copy link" }).click();
  await expect(dialog.getByRole("status")).toHaveText(/Link copied|copy it/);
  if (browserName === "chromium") {
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(link);
  }
  expect(page.url()).toBe(link);
  await dialog.getByRole("button", { name: "Close" }).click();
  await expect(dialog).toBeHidden();

  const opened = await context.newPage();
  const shared = await openLayers(opened, new URL(link).hash);
  await expect(layerNames(shared.list)).toHaveText(["Drawing", "Text", "Sphere"]);
  await expect(opened.getByRole("button", { name: "Undo" })).toBeDisabled();
  // Selecting the drawing layer on top shows the depth map.
  await expect(opened.getByRole("radio", { name: "Depth" })).toBeChecked();
  await expect(shared.canvas).toHaveAttribute("data-output", "depth");
  expect(await settledPixels(shared.canvas, 0)).toBe(depth);

  for (const watched of [{ violations, errors }, shared]) {
    expect(watched.violations).toEqual([]);
    expect(watched.errors).toEqual([]);
  }
});

test("a damaged link shows an error and opens the default scene", async ({ page }) => {
  const { list, violations, errors } = await openLayers(page, "#r=1.AAAAbroken");
  await expect(page.getByRole("alert")).toContainText("damaged or incomplete");
  await expect(layerNames(list)).toHaveText(["Sphere"]);
  await page.getByRole("button", { name: "Dismiss" }).click();
  await expect(page.getByRole("alert")).toBeHidden();
  expect(violations).toEqual([]);
  expect(errors).toEqual([]);
});

test("the toolbar fits the screen with all its buttons", async ({ page }) => {
  await openLayers(page);
  for (const name of ["Gallery", "Open", "Save", "Share", "View", "Undo", "Redo"]) {
    await expect(page.getByRole("button", { name, exact: true })).toBeInViewport({ ratio: 1 });
  }
  const overflow = await page
    .locator(".toolbar")
    .evaluate((toolbar) => toolbar.scrollWidth - toolbar.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
