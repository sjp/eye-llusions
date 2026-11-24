import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./guard.ts";
import { layerNames, openLayers, settledPixels, toolbarAction } from "./preview.ts";

test("a copied link opens the same scene in a new page", async ({ page, context, browserName }) => {
  if (browserName === "chromium") {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  }
  const { canvas, list } = await openLayers(page);
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

  await toolbarAction(page, "Share");
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
});

test("a damaged link shows an error and opens the default scene", async ({ page }) => {
  const { list } = await openLayers(page, "#r=1.AAAAbroken");
  await expect(page.getByRole("alert")).toContainText("damaged or incomplete");
  await expect(layerNames(list)).toHaveText(["Sphere"]);
  await page.getByRole("button", { name: "Dismiss" }).click();
  await expect(page.getByRole("alert")).toBeHidden();
});

/** Checks the control is wholly on screen, inside the toolbar's side padding, and on top. */
async function reachable(page: Page, control: Locator) {
  await expect(control).toBeInViewport({ ratio: 1 });
  const box = await control.boundingBox();
  const width = page.viewportSize()?.width ?? 0;
  expect(box).not.toBeNull();
  if (box === null) {
    return;
  }
  expect(box.x).toBeGreaterThanOrEqual(12);
  expect(box.x + box.width).toBeLessThanOrEqual(width - 12);
  expect(box.width).toBeGreaterThanOrEqual(44);
  expect(box.height).toBeGreaterThanOrEqual(44);
  const hit = await control.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const top = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
    return top !== null && element.contains(top);
  });
  expect(hit).toBe(true);
}

for (const width of [undefined, 375, 360, 320]) {
  test(`every toolbar action is reachable ${width === undefined ? "at the device's width" : `at ${String(width)} px`}`, async ({
    page,
  }) => {
    if (width !== undefined) {
      await page.setViewportSize({ width, height: Math.round(width * 2) });
    }
    await openLayers(page);
    await page.getByRole("button", { name: "New seed" }).click();
    await page.getByRole("button", { name: "Undo" }).click();
    const toolbar = page.locator(".toolbar");
    for (const name of ["Gallery", "View", "Undo", "Redo"]) {
      await reachable(page, toolbar.getByRole("button", { name, exact: true }));
    }
    const overflow = await toolbar.evaluate((element) => element.scrollWidth - element.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);

    const more = toolbar.getByRole("button", { name: "More" });
    if ((page.viewportSize()?.width ?? 0) < 450) {
      await reachable(page, more);
      await more.click();
      for (const name of ["Open", "Save", "Share"]) {
        const item = page.getByRole("menuitem", { name });
        await expect(item).toBeInViewport({ ratio: 1 });
        expect((await item.boundingBox())?.height).toBeGreaterThanOrEqual(44);
      }
      await page.getByRole("menuitem", { name: "Share" }).click();
    } else {
      await expect(more).toHaveCount(0);
      for (const name of ["Open", "Save", "Share"]) {
        await reachable(page, toolbar.getByRole("button", { name, exact: true }));
      }
      await toolbar.getByRole("button", { name: "Share" }).click();
    }
    const dialog = page.getByRole("dialog", { name: "Share" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Close" }).click();
    await page.getByRole("button", { name: "Redo" }).click();
    await expect(page.getByRole("button", { name: "Redo" })).toBeDisabled();
  });
}
