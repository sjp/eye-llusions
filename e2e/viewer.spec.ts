import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./guard.ts";
import { openCreate } from "./preview.ts";

async function openViewer(page: Page) {
  await openCreate(page);
  await expect(page.locator(".preview-canvas")).toHaveAttribute("data-quality", "full");
  await page.getByRole("button", { name: "View" }).click();
  const viewer = page.getByRole("dialog", { name: "Viewer" });
  await expect(viewer).toBeVisible();
  const canvas = viewer.locator(".preview-canvas");
  await expect(canvas).toHaveAttribute("data-quality", "full");
  return { viewer, canvas };
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
  const { viewer, canvas } = await openViewer(page);
  // Headless Firefox resizes the window to its own screen size a moment after going full
  // screen, so measure against the window once the layout has settled.
  await expect(async () => {
    const size = await page.evaluate(() => [window.innerWidth, window.innerHeight]);
    const shown = await box(viewer);
    expect(shown.width).toBeCloseTo(size[0], 0);
    expect(shown.height).toBeCloseTo(size[1], 0);
    // Rendered at the device pixel ratio.
    const ratio = await page.evaluate(() => window.devicePixelRatio);
    const pixels = await canvas.evaluate((element: HTMLCanvasElement) => element.width);
    expect(pixels).toBeCloseTo((await box(canvas)).width * ratio, -1);
  }).toPass();
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
});

test("the instructions leave the hint in sight and help people who can't see it", async ({
  page,
}) => {
  const { viewer } = await openViewer(page);
  const help = page.getByRole("region", { name: "How to view" });
  const hint = viewer.getByText("until you see three dots");
  await expect(help).toContainText("look through it");
  await expect(help).not.toContainText("fingertip");
  await expect(async () => {
    const [panel, line] = [await box(help), await box(hint)];
    expect(panel.y + panel.height).toBeLessThanOrEqual(line.y);
  }).toPass();
  await expect(hint).toBeInViewport({ ratio: 1 });

  await help.getByText("Can't see it?").click();
  await expect(help).toContainText(/strips here are about \d+ mm wide/);
  await help.getByRole("button", { name: "Switch to cross-eyed" }).click();
  await expect(viewer.getByText("Cross your eyes until you see three dots")).toBeVisible();
  await expect(help).toContainText("fingertip");
  await expect(help.getByRole("button", { name: "Switch to wall-eyed" })).toBeVisible();
});

test("Escape closes the instructions, then leaves the viewer", async ({ page }) => {
  const { viewer } = await openViewer(page);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("region", { name: "How to view" })).toBeHidden();
  await expect(viewer).toBeVisible();
  await page.keyboard.press("Escape");
  await expectCreate(page);
});

test("leaving full screen closes the instructions first, then the viewer", async ({ page }) => {
  const { viewer } = await openViewer(page);
  const fullscreen = () => page.evaluate(() => document.fullscreenElement !== null);
  test.skip(!(await fullscreen()), "This browser doesn't go full screen");
  await page.evaluate(() => document.exitFullscreen());
  await expect(page.getByRole("region", { name: "How to view" })).toBeHidden();
  await expect(viewer).toBeVisible();
  expect(await page.evaluate(() => document.activeElement?.tagName)).toBe("BUTTON");

  await viewer.getByRole("button", { name: "Exit" }).click();
  await expectCreate(page);
  await page.getByRole("button", { name: "View" }).click();
  await expect.poll(fullscreen).toBe(true);
  await page.evaluate(() => document.exitFullscreen());
  await expectCreate(page);
});

test("going back leaves the viewer, not the app", async ({ page }) => {
  await openViewer(page);
  const url = page.url();
  await page.goBack();
  await expectCreate(page);
  expect(page.url()).toBe(url);
});

test("the alignment dots sit one far-plane strip apart above the image", async ({ page }) => {
  const { viewer, canvas } = await openViewer(page);
  const dots = viewer.locator(".viewer-dot");
  await expect(dots).toHaveCount(2);
  // Polled, as the window can still be resizing for full screen.
  await expect(async () => {
    const image = await box(canvas);
    const [left, right] = [await box(dots.nth(0)), await box(dots.nth(1))];
    const centre = (dot: typeof left) => dot.x + dot.width / 2;
    // The default recipe repeats eight times across the image.
    expect(centre(right) - centre(left)).toBeCloseTo(image.width / 8, 1);
    expect((centre(left) + centre(right)) / 2).toBeCloseTo(image.x + image.width / 2, 1);
    expect(left.y + left.height).toBeLessThanOrEqual(image.y);
    expect(left.y).toBeGreaterThan(image.y - 40);
  }).toPass();
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
