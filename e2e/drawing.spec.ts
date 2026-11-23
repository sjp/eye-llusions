import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./guard.ts";
import { openLayers, renders, settledPixels } from "./preview.ts";

type Step = { type: "down" | "move" | "up"; id: number; x: number; y: number };

/** Opens Create, adds a drawing layer and waits for its depth view. */
async function openDrawing(page: Page) {
  const opened = await openLayers(page);
  const { canvas } = opened;
  let count = await renders(canvas);
  await page.getByRole("radio", { name: "Depth" }).check();
  await settledPixels(canvas, count);
  count = await renders(canvas);
  await page.getByRole("button", { name: "Add drawing" }).click();
  const surface = page.getByRole("img", { name: "Drawing surface" });
  await expect(surface).toHaveAttribute("data-strokes", "0");
  await expect(page.getByRole("radio", { name: "Depth" })).toBeChecked();
  await expect(page.getByRole("radio", { name: "Draw" })).toBeChecked();
  const before = await settledPixels(canvas, count);
  return { ...opened, surface, before };
}

/** Client coordinates at fractions of the surface's box. */
async function at(surface: Locator, points: [number, number][]): Promise<[number, number][]> {
  const box = await surface.boundingBox();
  if (box === null) {
    throw new Error("The drawing surface isn't visible");
  }
  return points.map(([fx, fy]) => [box.x + fx * box.width, box.y + fy * box.height]);
}

/** Pointer events as a touch screen would send them, dispatched on the surface. */
async function touch(surface: Locator, steps: Step[]): Promise<void> {
  await surface.evaluate((element, list: Step[]) => {
    for (const { type, id, x, y } of list) {
      element.dispatchEvent(
        new PointerEvent(`pointer${type}`, {
          pointerId: id,
          pointerType: "touch",
          isPrimary: id === 1,
          clientX: x,
          clientY: y,
          button: type === "move" ? -1 : 0,
          buttons: type === "up" ? 0 : 1,
          pressure: type === "up" ? 0 : 0.5,
          bubbles: true,
          cancelable: true,
        }),
      );
    }
  }, steps);
}

test("a mouse stroke adds a stroke that undo removes", async ({ page }) => {
  const { canvas, surface, before } = await openDrawing(page);
  const points = await at(surface, [
    [0.2, 0.3],
    [0.4, 0.5],
    [0.6, 0.4],
    [0.8, 0.6],
  ]);
  let count = await renders(canvas);
  await page.mouse.move(...points[0]);
  await page.mouse.down();
  for (const point of points.slice(1)) {
    await page.mouse.move(...point, { steps: 5 });
  }
  await page.mouse.up();
  await expect(surface).toHaveAttribute("data-strokes", "1");
  const drawn = await settledPixels(canvas, count);
  expect(drawn).not.toBe(before);

  count = await renders(canvas);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(surface).toHaveAttribute("data-strokes", "0");
  expect(await settledPixels(canvas, count)).toBe(before);
});

test("a touch stroke adds a stroke", async ({ page }) => {
  const { canvas, surface, before } = await openDrawing(page);
  const points = await at(surface, [
    [0.3, 0.3],
    [0.5, 0.5],
    [0.7, 0.5],
  ]);
  const count = await renders(canvas);
  await touch(surface, [
    { type: "down", id: 1, x: points[0][0], y: points[0][1] },
    ...points.slice(1).map(([x, y]): Step => ({ type: "move", id: 1, x, y })),
    { type: "up", id: 1, x: points[2][0], y: points[2][1] },
  ]);
  await expect(surface).toHaveAttribute("data-strokes", "1");
  expect(await settledPixels(canvas, count)).not.toBe(before);
});

test("a two-finger gesture zooms without adding a stroke", async ({ page }) => {
  const { surface } = await openDrawing(page);
  const original = await surface.boundingBox();
  const [a0, b0, a1, b1] = await at(surface, [
    [0.45, 0.5],
    [0.55, 0.5],
    [0.3, 0.5],
    [0.7, 0.5],
  ]);
  await touch(surface, [
    { type: "down", id: 1, x: a0[0], y: a0[1] },
    { type: "move", id: 1, x: a0[0] - 2, y: a0[1] },
    { type: "down", id: 2, x: b0[0], y: b0[1] },
    { type: "move", id: 1, x: a1[0], y: a1[1] },
    { type: "move", id: 2, x: b1[0], y: b1[1] },
    { type: "up", id: 1, x: a1[0], y: a1[1] },
    { type: "up", id: 2, x: b1[0], y: b1[1] },
  ]);
  const reset = page.getByRole("button", { name: "Reset zoom" });
  await expect(reset).toBeVisible();
  await expect(surface).toHaveAttribute("data-strokes", "0");
  // The second finger cancelled the stroke the first one started.
  await expect(page.getByRole("button", { name: "Undo" })).toBeEnabled();
  // The fingers spread nearly four times as far apart.
  const zoomed = await surface.boundingBox();
  expect(zoomed?.width).toBeGreaterThan((original?.width ?? 0) * 3.5);

  await reset.click();
  await expect(reset).toBeHidden();
});

test("real touches draw with one finger and zoom with two", async ({
  page,
  browserName,
  isMobile,
}) => {
  test.skip(browserName !== "chromium" || !isMobile, "Needs Chromium's touch emulation");
  const { surface } = await openDrawing(page);
  const cdp = await page.context().newCDPSession(page);
  const send = async (
    type: "touchStart" | "touchMove" | "touchEnd",
    points: [number, number][],
  ) => {
    await cdp.send("Input.dispatchTouchEvent", {
      type,
      touchPoints: points.map(([x, y], id) => ({ x, y, id })),
    });
  };
  const [a, b, c, d] = await at(surface, [
    [0.3, 0.4],
    [0.6, 0.6],
    [0.45, 0.5],
    [0.55, 0.5],
  ]);
  await send("touchStart", [a]);
  for (let step = 1; step <= 8; step++) {
    const t = step / 8;
    await send("touchMove", [[a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]]);
  }
  await send("touchEnd", []);
  await expect(surface).toHaveAttribute("data-strokes", "1");

  await send("touchStart", [c, d]);
  for (let step = 1; step <= 8; step++) {
    await send("touchMove", [
      [c[0] - step * 10, c[1]],
      [d[0] + step * 10, d[1]],
    ]);
  }
  await send("touchEnd", []);
  await expect(page.getByRole("button", { name: "Reset zoom" })).toBeVisible();
  await expect(surface).toHaveAttribute("data-strokes", "1");
});
