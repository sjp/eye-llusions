import { expect, test, type Locator, type Page } from "@playwright/test";
import { watchPage } from "./guard.ts";
import { openCreate } from "./preview.ts";

declare global {
  interface Window {
    /** Every preview frame drawn, as "quality:output". */
    previewLog: string[];
  }
}

async function open(page: Page, viewport?: { width: number; height: number }) {
  if (viewport !== undefined) {
    await page.setViewportSize(viewport);
  }
  const watched = await watchPage(page);
  await page.addInitScript(() => {
    window.previewLog = [];
    new MutationObserver((records) => {
      for (const record of records) {
        if (record.target instanceof HTMLCanvasElement) {
          const { quality = "", output = "" } = record.target.dataset;
          window.previewLog.push(`${quality}:${output}`);
        }
      }
    }).observe(document, { subtree: true, attributes: true, attributeFilter: ["data-renders"] });
  });
  await openCreate(page);
  const canvas = page.locator(".preview-canvas");
  await expect(canvas).toHaveAttribute("data-quality", "full");
  return { ...watched, canvas };
}

async function box(locator: Locator) {
  const result = await locator.boundingBox();
  expect(result).not.toBeNull();
  return result ?? { x: 0, y: 0, width: 0, height: 0 };
}

/** Distinct colours in the canvas's pixels and whether every pixel is grey. */
function colours(canvas: Locator) {
  return canvas.evaluate((element: HTMLCanvasElement) => {
    const context = element.getContext("2d");
    if (context === null) {
      throw new Error("No 2D context");
    }
    const { data } = context.getImageData(0, 0, element.width, element.height);
    const seen = new Set<number>();
    let grey = true;
    for (let i = 0; i < data.length; i += 4) {
      seen.add((data[i] << 16) | (data[i + 1] << 8) | data[i + 2]);
      grey &&= data[i] === data[i + 1] && data[i + 1] === data[i + 2];
    }
    return { count: seen.size, grey };
  });
}

test("wide screens show the controls beside the preview", async ({ page }) => {
  const { canvas, violations, errors } = await open(page, { width: 1280, height: 800 });
  const sheet = page.getByRole("complementary", { name: "Controls" });
  const preview = await box(page.locator(".preview"));
  const panel = await box(sheet);
  expect(panel.x).toBeGreaterThanOrEqual(preview.x + preview.width);
  expect(panel.height).toBeGreaterThan(600);
  await expect(page.getByRole("button", { name: "Controls" })).toBeHidden();
  await expect(page.getByRole("slider", { name: "Repeats" })).toBeVisible();
  const shown = await box(canvas);
  expect(shown.width).toBeGreaterThan(700);
  expect(violations).toEqual([]);
  expect(errors).toEqual([]);
});

test("narrow screens show a bottom sheet that drags open", async ({ page }) => {
  const { canvas, violations, errors } = await open(page, { width: 390, height: 844 });
  const sheet = page.getByRole("complementary", { name: "Controls" });
  const handle = page.getByRole("button", { name: "Controls" });
  await expect(handle).toBeVisible();

  const closed = await box(sheet);
  expect(closed.width).toBe(390);
  expect(closed.y + closed.height).toBeCloseTo(844, 0);
  const preview = await box(canvas);
  expect(preview.width).toBeGreaterThan(350);
  expect(preview.y + preview.height).toBeLessThanOrEqual(closed.y);

  const grip = await box(handle);
  const x = grip.x + grip.width / 2;
  const y = grip.y + grip.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let step = 1; step <= 10; step++) {
    await page.mouse.move(x, y - step * 40);
  }
  await page.mouse.up();
  await expect(handle).toHaveAttribute("aria-expanded", "true");
  await expect(sheet).toHaveAttribute("data-snap", "half");
  await expect.poll(async () => (await box(sheet)).height).toBeCloseTo(422, 0);
  await expect(page.getByRole("button", { name: "New seed" })).toBeInViewport();

  // The preview moves up to stay clear of the open sheet.
  await expect
    .poll(async () => {
      const shown = await box(canvas);
      return shown.y + shown.height <= (await box(sheet)).y;
    })
    .toBe(true);

  await handle.click();
  await expect(sheet).toHaveAttribute("data-snap", "peek");
  expect(violations).toEqual([]);
  expect(errors).toEqual([]);
});

test("the keyboard moves the bottom sheet through every height", async ({ page }) => {
  const { errors } = await open(page, { width: 390, height: 844 });
  const sheet = page.getByRole("complementary", { name: "Controls" });
  const handle = page.getByRole("button", { name: "Controls" });
  await handle.focus();
  await page.keyboard.press("Enter");
  await expect(sheet).toHaveAttribute("data-snap", "half");
  await page.keyboard.press("Space");
  await expect(sheet).toHaveAttribute("data-snap", "full");
  await expect(handle).toHaveAttribute("aria-expanded", "true");
  await expect(handle).toHaveAccessibleDescription("Fully open");
  await page.keyboard.press("ArrowDown");
  await expect(sheet).toHaveAttribute("data-snap", "half");
  await page.keyboard.press("ArrowDown");
  await expect(sheet).toHaveAttribute("data-snap", "peek");
  await expect(handle).toHaveAttribute("aria-expanded", "false");
  await page.keyboard.press("Space");
  await page.keyboard.press("Enter");
  await expect(sheet).toHaveAttribute("data-snap", "full");
  await expect(handle).toBeFocused();
  expect(errors).toEqual([]);
});

test("the bottom sheet doesn't animate when motion is reduced", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await open(page, { width: 390, height: 844 });
  const sheet = page.getByRole("complementary", { name: "Controls" });
  await expect(sheet).toHaveCSS("transition-duration", "0s");
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await expect(sheet).not.toHaveCSS("transition-duration", "0s");
});

test("the preview toggles between the stereogram and the depth map", async ({ page }) => {
  const { canvas, violations, errors } = await open(page);
  await expect(canvas).toHaveAttribute("data-output", "stereogram");
  // The default texture is two-tone random dots.
  expect((await colours(canvas)).count).toBeLessThanOrEqual(2);

  await page.getByRole("radio", { name: "Depth" }).click();
  await expect(canvas).toHaveAttribute("data-output", "depth");
  await expect(canvas).toHaveAttribute("data-quality", "full");
  await expect(page.getByRole("img", { name: "Depth map preview" })).toBeVisible();
  const depth = await colours(canvas);
  expect(depth.grey).toBe(true);
  expect(depth.count).toBeGreaterThan(10);

  await page.getByRole("radio", { name: "Stereogram" }).click();
  await expect(canvas).toHaveAttribute("data-output", "stereogram");
  expect(violations).toEqual([]);
  expect(errors).toEqual([]);
});

test("dragging a view slider previews drafts and undoes as one step", async ({
  page,
  isMobile,
}) => {
  const { violations, errors } = await open(page);
  const handle = page.getByRole("button", { name: "Controls" });
  if (await handle.isVisible()) {
    await handle.click();
  }
  const slider = page.getByRole("slider", { name: "Repeats" });
  await expect(slider).toBeInViewport();
  await expect(slider).toHaveValue("8");
  if (isMobile) {
    // Playwright can't drag a range input by touch, so replay the events a drag fires.
    await slider.evaluate(async (input: HTMLInputElement) => {
      for (let value = 9; value <= 20; value++) {
        input.value = String(value);
        input.dispatchEvent(new Event("input", { bubbles: true }));
        await new Promise((resolve) => {
          setTimeout(resolve, 16);
        });
      }
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
  } else {
    const track = await box(slider);
    const y = track.y + track.height / 2;
    // Repeats runs from 2 to 32, so 8 sits a fifth of the way along.
    const start = track.x + track.width * 0.2;
    await page.mouse.move(start, y);
    await page.mouse.down();
    for (let step = 1; step <= 10; step++) {
      await page.mouse.move(start + step * track.width * 0.04, y);
      await page.waitForTimeout(16);
    }
    await page.mouse.up();
  }

  const dragged = Number(await slider.inputValue());
  expect(dragged).toBeGreaterThan(15);
  // Drafts show while dragging, then a full render once the drag settles.
  await expect
    .poll(() => page.evaluate(() => window.previewLog.slice(1)))
    .toEqual(expect.arrayContaining(["draft:stereogram"]));
  await expect.poll(() => page.evaluate(() => window.previewLog.at(-1))).toBe("full:stereogram");
  const log = await page.evaluate(() => window.previewLog);
  expect(log.filter((entry) => entry === "draft:stereogram").length).toBeGreaterThan(1);

  const undo = page.getByRole("button", { name: "Undo" });
  await undo.click();
  await expect(slider).toHaveValue("8");
  await expect(undo).toBeDisabled();
  await page.getByRole("button", { name: "Redo" }).click();
  await expect(slider).toHaveValue(String(dragged));
  expect(violations).toEqual([]);
  expect(errors).toEqual([]);
});

test("keyboard shortcuts undo and redo a slider step", async ({ page, isMobile }) => {
  test.skip(isMobile, "Phones have no keyboard shortcuts");
  await open(page);
  const slider = page.getByRole("slider", { name: "Repeats" });
  await slider.focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await expect(slider).toHaveValue("10");
  await page.keyboard.press("ControlOrMeta+z");
  await expect(slider).toHaveValue("9");
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect(slider).toHaveValue("10");
});

test.describe("at a fractional device pixel ratio", () => {
  test.use({ deviceScaleFactor: 2.625, viewport: { width: 411, height: 731 } });

  test("the full preview is shown one canvas pixel per device pixel", async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== "chromium", "Only Chromium emulates a fractional ratio");
    const { canvas } = await open(page);
    const sizes = await canvas.evaluate((element: HTMLCanvasElement) => {
      const { width, height } = element.getBoundingClientRect();
      const ratio = window.devicePixelRatio;
      return {
        ratio,
        pixels: [element.width, element.height],
        shown: [width * ratio, height * ratio],
      };
    });
    expect(sizes.ratio).toBe(2.625);
    // Layout rounds to 1/64 of a CSS pixel; anything well under a device pixel is exact.
    expect(sizes.shown[0]).toBeCloseTo(sizes.pixels[0], 1);
    expect(sizes.shown[1]).toBeCloseTo(sizes.pixels[1], 1);
  });
});
