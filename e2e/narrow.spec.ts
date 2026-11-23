import type { Page } from "@playwright/test";
import { expect, test } from "./guard.ts";
import { openLayers, toolbarAction } from "./preview.ts";

test.use({ viewport: { width: 360, height: 740 } });

/** Fails if anything widens the page past the screen. */
async function expectNoSideways(page: Page) {
  const overflow = await page.evaluate(() => {
    const root = document.documentElement;
    return root.scrollWidth - root.clientWidth;
  });
  expect(overflow).toBeLessThanOrEqual(0);
}

test("the gallery fits a 360 px screen", async ({ page }) => {
  await page.goto("./");
  await expect(page.getByRole("button", { name: "Start from blank" })).toBeInViewport();
  await expectNoSideways(page);
});

test("Create, its fully open controls and its dialogs fit a 360 px screen", async ({ page }) => {
  await openLayers(page);
  const sheet = page.getByRole("complementary", { name: "Controls" });
  // Opened half way; a key press opens it fully.
  await page.getByRole("button", { name: "Controls" }).press("Space");
  await expect(sheet).toHaveAttribute("data-snap", "full");
  for (const name of ["Add shape", "Add text", "Add drawing", "Add image"]) {
    const button = page.getByRole("button", { name });
    await button.scrollIntoViewIfNeeded();
    await expect(button).toBeInViewport({ ratio: 1 });
  }
  await expectNoSideways(page);

  for (const [action, name] of [
    ["Share", "Share"],
    ["Save", "Save PNG"],
  ] as const) {
    await toolbarAction(page, action);
    const dialog = page.getByRole("dialog", { name });
    const close = dialog.getByRole("button", { name: "Close" });
    await expect(close).toBeInViewport({ ratio: 1 });
    const box = await dialog.boundingBox();
    expect(box?.x).toBeGreaterThanOrEqual(0);
    expect((box?.x ?? 0) + (box?.width ?? Infinity)).toBeLessThanOrEqual(360);
    await expectNoSideways(page);
    await close.click();
    await expect(dialog).toBeHidden();
  }
});

test("the viewer's controls for moving between samples fit a 360 px screen", async ({ page }) => {
  await page.goto("./");
  await page.getByRole("button", { name: "View Heart" }).click();
  const viewer = page.getByRole("dialog", { name: "Viewer" });
  await expect(viewer.locator(".preview-canvas")).toHaveAttribute("data-quality", "full");
  for (const name of ["Previous sample", "Next sample", "Exit", "How to view"]) {
    await expect(viewer.getByRole("button", { name, exact: true })).toBeInViewport({ ratio: 1 });
  }
  await expectNoSideways(page);
});

test("the viewer's controls fit a 360 px screen", async ({ page }) => {
  await openLayers(page);
  await page.getByRole("button", { name: "View" }).click();
  const viewer = page.getByRole("dialog", { name: "Viewer" });
  await expect(viewer.locator(".preview-canvas")).toHaveAttribute("data-quality", "full");
  for (const name of [
    "Exit",
    "Peek",
    "Phone",
    "Monitor",
    "Zoom out",
    "Zoom in",
    "Size to fit",
    "Full screen",
    "How to view",
  ]) {
    const button = viewer.getByRole("button", { name, exact: true });
    // Only where the browser can go full screen.
    if (name !== "Full screen" || (await button.count()) > 0) {
      await expect(button).toBeInViewport({ ratio: 1 });
    }
  }
  await expectNoSideways(page);
});
