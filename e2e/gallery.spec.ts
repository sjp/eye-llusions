import { readFileSync } from "node:fs";
import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./guard.ts";
import { layerNames, openLayers, settledPixels, toolbarAction } from "./preview.ts";

/** The share of pixels brighter than black, and the number of distinct colours. */
function inked(canvas: Locator) {
  return canvas.evaluate((element: HTMLCanvasElement) => {
    const context = element.getContext("2d");
    if (context === null) {
      throw new Error("No 2D context");
    }
    const { data } = context.getImageData(0, 0, element.width, element.height);
    const colours = new Set<number>();
    let bright = 0;
    for (let i = 0; i < data.length; i += 4) {
      colours.add((data[i] << 16) | (data[i + 1] << 8) | data[i + 2]);
      bright += data[i] + data[i + 1] + data[i + 2] > 0 ? 1 : 0;
    }
    return { bright: bright / (data.length / 4), colours: colours.size };
  });
}

async function openGallery(page: Page) {
  await page.goto("./");
  await expect(page.getByRole("button", { name: "Start from blank" })).toBeVisible();
}

/** Remixes a sample and shows the controls, as `openLayers` does for a blank scene. */
async function remix(page: Page, title: string) {
  await page.getByRole("button", { name: `Remix ${title}` }).click();
  const canvas = page.locator(".preview-canvas");
  await expect(canvas).toHaveAttribute("data-quality", "full");
  const handle = page.getByRole("button", { name: "Controls" });
  if (await handle.isVisible()) {
    await handle.click();
  }
  return { canvas, list: page.getByRole("list", { name: "Layer stack, top first" }) };
}

test("the gallery is the first screen and draws every thumbnail", async ({ page }) => {
  await openGallery(page);
  const thumbnails = page.getByRole("img", { name: /stereogram$/ });
  const count = await thumbnails.count();
  expect(count).toBeGreaterThanOrEqual(8);
  for (let i = 0; i < count; i++) {
    const thumbnail = thumbnails.nth(i);
    await thumbnail.scrollIntoViewIfNeeded();
    await expect(thumbnail).toHaveAttribute("data-ready", "true");
    await expect.poll(async () => (await inked(thumbnail)).colours).toBeGreaterThan(1);
  }
});

test("a remixed and edited sample survives a share link, figure included", async ({
  page,
  context,
}) => {
  await openGallery(page);
  const { canvas, list } = await remix(page, "Heart");
  await expect(layerNames(list)).toHaveText(["Heart"]);
  await expect(page.getByRole("button", { name: "Undo" })).toBeDisabled();
  await page.getByRole("radio", { name: "Depth" }).check();
  const heart = await settledPixels(canvas, 0);

  const before = Number(await canvas.getAttribute("data-renders"));
  await page.getByRole("radio", { name: "Star", exact: true }).check();
  const star = await settledPixels(canvas, before);
  expect(star).not.toBe(heart);
  expect((await inked(canvas)).bright).toBeGreaterThan(0.1);

  await toolbarAction(page, "Share");
  const dialog = page.getByRole("dialog", { name: "Share" });
  const link = await dialog.getByRole("textbox", { name: "Link" }).inputValue();
  await dialog.getByRole("button", { name: "Close" }).click();

  const opened = await context.newPage();
  const shared = await openLayers(opened, new URL(link).hash);
  await expect(layerNames(shared.list)).toHaveText(["Heart"]);
  await opened.getByRole("radio", { name: "Depth" }).check();
  await expect(opened.getByRole("radio", { name: "Star", exact: true })).toBeChecked();
  expect(await settledPixels(shared.canvas, 0)).toBe(star);
});

test("going back to the gallery asks before dropping changes", async ({ page }) => {
  await openGallery(page);
  await remix(page, "Hello");
  await page.getByRole("button", { name: "Gallery" }).click();
  await expect(page.getByRole("button", { name: "Start from blank" })).toBeVisible();

  await remix(page, "Hello");
  await page.getByRole("button", { name: "New seed" }).click();
  await page.getByRole("button", { name: "Gallery" }).click();
  const dialog = page.getByRole("dialog", { name: "Leave this scene?" });
  await dialog.getByRole("button", { name: "Keep editing" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("button", { name: "Undo" })).toBeEnabled();

  await page.getByRole("button", { name: "Gallery" }).click();
  await dialog.getByRole("button", { name: "Go to gallery" }).click();
  await expect(page.getByRole("button", { name: "Start from blank" })).toBeVisible();
});

test("Back from Create returns to the gallery, asking first when the scene changed", async ({
  page,
}) => {
  await openGallery(page);
  const blank = page.getByRole("button", { name: "Start from blank" });
  await remix(page, "Hello");
  await page.goBack();
  await expect(blank).toBeVisible();

  await remix(page, "Hello");
  await page.getByRole("button", { name: "New seed" }).click();
  await page.getByRole("button", { name: "View" }).click();
  const viewer = page.getByRole("dialog", { name: "Viewer" });
  await expect(viewer).toBeVisible();
  await page.goBack();
  await expect(viewer).toBeHidden();
  await expect(page.getByRole("button", { name: "Undo" })).toBeEnabled();

  await page.goBack();
  const dialog = page.getByRole("dialog", { name: "Leave this scene?" });
  await dialog.getByRole("button", { name: "Keep editing" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("button", { name: "Undo" })).toBeEnabled();

  await page.goBack();
  await dialog.getByRole("button", { name: "Go to gallery" }).click();
  await expect(blank).toBeVisible();
});

test("viewing a sample opens the viewer and leads back to the gallery", async ({ page }) => {
  await openGallery(page);
  await page.getByRole("button", { name: "View Cat nap" }).click();
  const viewer = page.getByRole("dialog", { name: "Viewer" });
  await expect(viewer).toBeVisible();
  await expect(viewer.locator(".preview-canvas")).toHaveAttribute("data-quality", "full");
  await viewer.getByRole("button", { name: "Exit" }).click();
  await expect(page.getByRole("button", { name: "Start from blank" })).toBeVisible();
});

test("tapping a thumbnail views its sample", async ({ page }) => {
  await openGallery(page);
  await page.getByRole("img", { name: "Heart stereogram" }).click();
  const viewer = page.getByRole("dialog", { name: "Viewer" });
  await expect(viewer).toBeVisible();
  await viewer.getByRole("button", { name: "Exit" }).click();
  await expect(page.getByRole("button", { name: "View Heart" })).toBeFocused();
});

test("the viewer moves between samples with its buttons, arrow keys and swipes", async ({
  page,
}) => {
  await openGallery(page);
  await page.getByRole("button", { name: "View Heart" }).click();
  const viewer = page.getByRole("dialog", { name: "Viewer" });
  const title = viewer.locator(".viewer-title");
  const canvas = viewer.locator(".preview-canvas");
  await expect(title).toHaveText("Heart");
  await expect(canvas).toHaveAttribute("data-quality", "full");
  await page.getByRole("button", { name: "Got it" }).click();
  await viewer.getByRole("button", { name: "Next sample" }).click();
  await expect(title).toHaveText("Hello");
  await viewer.getByRole("button", { name: "Previous sample" }).click();
  await viewer.getByRole("button", { name: "Previous sample" }).click();
  await expect(title).toHaveText("Spiral stairs");
  await page.keyboard.press("ArrowRight");
  await expect(title).toHaveText("Heart");
  await page.keyboard.press("ArrowRight");
  await expect(title).toHaveText("Hello");
  await page.keyboard.press("ArrowLeft");
  await expect(title).toHaveText("Heart");

  // A finger swiping from right to left shows the next sample.
  await viewer.locator(".viewer-area").evaluate((area) => {
    const bounds = area.getBoundingClientRect();
    const y = bounds.y + bounds.height / 2;
    const points: [string, number][] = [
      ["pointerdown", bounds.x + bounds.width * 0.7],
      ["pointermove", bounds.x + bounds.width * 0.5],
      ["pointerup", bounds.x + bounds.width * 0.3],
    ];
    for (const [type, x] of points) {
      area.dispatchEvent(
        new PointerEvent(type, {
          pointerId: 9,
          pointerType: "touch",
          isPrimary: true,
          clientX: x,
          clientY: y,
          bubbles: true,
          cancelable: true,
        }),
      );
    }
  });
  await expect(title).toHaveText("Hello");
  await expect(canvas).toHaveAttribute("data-quality", "full");

  await viewer.getByRole("button", { name: "Exit" }).click();
  await expect(page.getByRole("button", { name: "View Hello" })).toBeFocused();
});

test("a file dropped on the gallery opens in Create", async ({ page, isMobile }) => {
  test.skip(isMobile, "Dragging files is a desktop gesture");
  await openGallery(page);
  await page.locator(".gallery").evaluate(
    (gallery, base64: string) => {
      const data = Uint8Array.from(atob(base64), (char) => char.codePointAt(0) ?? 0);
      const transfer = new DataTransfer();
      transfer.items.add(new File([data], "cone.png", { type: "image/png" }));
      for (const type of ["dragenter", "dragover", "drop"]) {
        gallery.dispatchEvent(
          new DragEvent(type, { dataTransfer: transfer, bubbles: true, cancelable: true }),
        );
      }
    },
    readFileSync(new URL("fixtures/cone.png", import.meta.url)).toString("base64"),
  );
  await expect(page.getByRole("alert")).toContainText("doesn't contain an Eye-llusion project");
  await expect(page.getByRole("button", { name: "View" })).toBeVisible();
});
