import { expect, test, type Locator, type Page } from "@playwright/test";
import { watchPage } from "./guard.ts";
import { openCreate } from "./preview.ts";

async function openViewer(page: Page) {
  const watched = await watchPage(page);
  await openCreate(page);
  await expect(page.locator(".preview-canvas")).toHaveAttribute("data-quality", "full");
  await page.getByRole("button", { name: "View" }).click();
  const viewer = page.getByRole("dialog", { name: "Viewer" });
  await expect(viewer).toBeVisible();
  const canvas = viewer.locator(".preview-canvas");
  await expect(canvas).toHaveAttribute("data-quality", "full");
  return { ...watched, viewer, canvas };
}

async function box(locator: Locator) {
  const result = await locator.boundingBox();
  expect(result).not.toBeNull();
  return result ?? { x: 0, y: 0, width: 0, height: 0 };
}

async function expectCreate(page: Page) {
  await expect(page.getByRole("dialog", { name: "Viewer" })).toBeHidden();
  await expect(page.getByRole("button", { name: "View" })).toBeVisible();
  await expect(page.locator(".preview-canvas")).toHaveAttribute("data-quality", "full");
  await expect.poll(() => page.evaluate(() => document.fullscreenElement)).toBeNull();
}

test("the viewer fills the screen and the Exit button leaves it", async ({ page }) => {
  const { viewer, canvas, violations, errors } = await openViewer(page);
  const size = page.viewportSize() ?? { width: 0, height: 0 };
  const shown = await box(viewer);
  expect(shown.width).toBeCloseTo(size.width, 0);
  expect(shown.height).toBeCloseTo(size.height, 0);
  // Rendered at the device pixel ratio.
  const ratio = await page.evaluate(() => window.devicePixelRatio);
  const pixels = await canvas.evaluate((element: HTMLCanvasElement) => element.width);
  expect(pixels).toBeCloseTo((await box(canvas)).width * ratio, -1);
  await expect(page.getByRole("region", { name: "How to view" })).toBeVisible();
  await page.getByRole("button", { name: "Got it" }).click();
  await expect(page.getByRole("region", { name: "How to view" })).toBeHidden();

  const url = page.url();
  await viewer.getByRole("button", { name: "Exit" }).click();
  await expectCreate(page);
  expect(page.url()).toBe(url);
  // Leaving view mode took its history entry with it.
  await page.getByRole("button", { name: "View" }).click();
  await expect(viewer).toBeVisible();
  // The instructions stay dismissed until asked for.
  await expect(page.getByRole("region", { name: "How to view" })).toBeHidden();
  expect(violations).toEqual([]);
  expect(errors).toEqual([]);
});

test("Escape leaves the viewer", async ({ page }) => {
  const { errors } = await openViewer(page);
  await page.keyboard.press("Escape");
  await expectCreate(page);
  expect(errors).toEqual([]);
});

test("going back leaves the viewer, not the app", async ({ page }) => {
  const { errors } = await openViewer(page);
  const url = page.url();
  await page.goBack();
  await expectCreate(page);
  expect(page.url()).toBe(url);
  expect(errors).toEqual([]);
});

test("the alignment dots sit one far-plane strip apart above the image", async ({ page }) => {
  const { viewer, canvas } = await openViewer(page);
  const dots = viewer.locator(".viewer-dot");
  await expect(dots).toHaveCount(2);
  const image = await box(canvas);
  const [left, right] = [await box(dots.nth(0)), await box(dots.nth(1))];
  const centre = (dot: typeof left) => dot.x + dot.width / 2;
  // The default recipe repeats eight times across the image.
  expect(centre(right) - centre(left)).toBeCloseTo(image.width / 8, 1);
  expect((centre(left) + centre(right)) / 2).toBeCloseTo(image.x + image.width / 2, 1);
  expect(left.y + left.height).toBeLessThanOrEqual(image.y);
  expect(left.y).toBeGreaterThan(image.y - 40);
  await expect(viewer.getByText("until you see three dots")).toBeVisible();
});

test("Peek toggles the depth map", async ({ page, isMobile }) => {
  const { viewer, canvas } = await openViewer(page);
  const peek = viewer.getByRole("button", { name: "Peek" });
  await peek.click();
  await expect(peek).toHaveAttribute("aria-pressed", "true");
  await expect(canvas).toHaveAttribute("data-output", "depth");
  await expect(viewer.getByRole("img", { name: "Depth map preview" })).toBeVisible();
  await peek.click();
  await expect(peek).toHaveAttribute("aria-pressed", "false");
  await expect(canvas).toHaveAttribute("data-output", "stereogram");

  if (!isMobile) {
    // Holding peeks only while held.
    const button = await box(peek);
    await page.mouse.move(button.x + button.width / 2, button.y + button.height / 2);
    await page.mouse.down();
    await expect(canvas).toHaveAttribute("data-output", "depth");
    await page.waitForTimeout(400);
    await page.mouse.up();
    await expect(peek).toHaveAttribute("aria-pressed", "false");
    await expect(canvas).toHaveAttribute("data-output", "stereogram");
  }
});

test("a size preset changes the repeats as an undoable step", async ({ page }) => {
  const { viewer, canvas } = await openViewer(page);
  const image = await box(canvas);
  await viewer.getByRole("button", { name: "Monitor" }).click();
  // 32 mm strips at 96 CSS pixels to the inch.
  const expected = Math.min(32, Math.max(2, Math.round((image.width * 25.4) / 96 / 32)));
  await expect(viewer.locator(".viewer-dot").nth(1)).toBeAttached();
  await viewer.getByRole("button", { name: "Exit" }).click();
  await expectCreate(page);
  const slider = page.getByRole("slider", { name: "Repeats" });
  await expect(slider).toHaveValue(String(expected));
  if (expected !== 8) {
    await page.getByRole("button", { name: "Undo" }).click();
    await expect(slider).toHaveValue("8");
  }
});

test("holding Peek and releasing off the button stops peeking", async ({ page, isMobile }) => {
  test.skip(isMobile, "Uses a mouse");
  const { viewer, canvas } = await openViewer(page);
  const peek = viewer.getByRole("button", { name: "Peek" });
  const button = await box(peek);
  await page.mouse.move(button.x + button.width / 2, button.y + button.height / 2);
  await page.mouse.down();
  await expect(canvas).toHaveAttribute("data-output", "depth");
  await page.waitForTimeout(400);
  await page.mouse.move(button.x + button.width / 2, button.y + button.height * 4, { steps: 5 });
  await page.mouse.up();
  await expect(peek).toHaveAttribute("aria-pressed", "false");
  await expect(canvas).toHaveAttribute("data-output", "stereogram");

  await peek.focus();
  await page.keyboard.press("Enter");
  await expect(peek).toHaveAttribute("aria-pressed", "true");
});
