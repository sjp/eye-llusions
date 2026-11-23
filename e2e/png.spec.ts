import { readFileSync } from "node:fs";
import type { Page } from "@playwright/test";
import { expect, test } from "./guard.ts";
import { layerNames, openLayers, renders, settledPixels, toolbarAction } from "./preview.ts";

const CONE = new URL("fixtures/cone.png", import.meta.url);
const HALF_SKY = new URL("fixtures/half-sky.png", import.meta.url);

/** The size the page's browser decodes the PNG bytes to. */
async function decodedSize(page: Page, bytes: Buffer): Promise<number[]> {
  return page.evaluate(async (base64) => {
    const data = Uint8Array.from(atob(base64), (char) => char.codePointAt(0) ?? 0);
    const bitmap = await createImageBitmap(new Blob([data], { type: "image/png" }));
    return [bitmap.width, bitmap.height];
  }, bytes.toString("base64"));
}

test("a saved PNG reopens the same project with its images", async ({ page, context }) => {
  const { canvas } = await openLayers(page);
  let count = await renders(canvas);
  await page.getByRole("radio", { name: "Depth" }).check();
  await settledPixels(canvas, count);
  await page.getByRole("button", { name: "Add image" }).click();
  count = await renders(canvas);
  await page.getByLabel("Image file").setInputFiles(CONE.pathname);
  await expect(page.getByRole("img", { name: "Processed depth" })).toBeVisible();
  const depth = await settledPixels(canvas, count);
  await page.getByRole("radio", { name: "Tile" }).check();
  await page.getByLabel("Tile image").setInputFiles(HALF_SKY.pathname);
  await expect(page.getByRole("button", { name: "Replace tile" })).toBeVisible();

  await toolbarAction(page, "Save");
  const dialog = page.getByRole("dialog", { name: "Save PNG" });
  await expect(dialog.getByText(/Some apps remove the project/)).toBeVisible();
  await dialog.getByRole("radio", { name: "Custom" }).check();
  const width = dialog.getByRole("spinbutton", { name: "Width" });
  await width.fill("640");
  await width.press("Tab");
  await expect(dialog.locator("[data-width]")).toHaveAttribute("data-height", "360");
  const downloading = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "Download" }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toBe("eye-llusion-640x360.png");
  const path = await download.path();
  expect(await decodedSize(page, readFileSync(path))).toEqual([640, 360]);
  await dialog.getByRole("button", { name: "Close" }).click();
  await expect(dialog).toBeHidden();

  const opened = await context.newPage();
  const reopened = await openLayers(opened);
  count = await renders(reopened.canvas);
  await opened.getByRole("radio", { name: "Depth" }).check();
  await settledPixels(reopened.canvas, count);
  count = await renders(reopened.canvas);
  await opened.getByLabel("PNG file").setInputFiles(path);
  await expect(layerNames(reopened.list)).toHaveText(["Image", "Sphere"]);
  expect(await settledPixels(reopened.canvas, count)).toBe(depth);
  await expect(opened.getByRole("img", { name: "Processed depth" })).toBeVisible();
  await expect(opened.getByText("Image missing")).toHaveCount(0);
  await expect(opened.getByRole("radio", { name: "Tile" })).toBeChecked();
  await expect(opened.getByRole("button", { name: "Replace tile" })).toBeVisible();
  await expect(opened.getByRole("button", { name: "Undo" })).toBeEnabled();
});

test("a PNG without a project can become an image layer", async ({ page }) => {
  const { list } = await openLayers(page);
  await page.getByLabel("PNG file").setInputFiles(CONE.pathname);
  const alert = page.getByRole("alert");
  await expect(alert).toContainText("doesn't contain an Eye-llusion project");
  await expect(layerNames(list)).toHaveText(["Sphere"]);
  await alert.getByRole("button", { name: "Add as image layer" }).click();
  await expect(alert).toBeHidden();
  await expect(layerNames(list)).toHaveText(["Image", "Sphere"]);
  await expect(page.getByRole("img", { name: "Processed depth" })).toBeVisible();
});

test("a file dropped on the app is opened", async ({ page, isMobile }) => {
  test.skip(isMobile, "Dragging files is a desktop gesture");
  const { list } = await openLayers(page);
  const transfer = await page.evaluateHandle((base64) => {
    const data = Uint8Array.from(atob(base64), (char) => char.codePointAt(0) ?? 0);
    const dropped = new DataTransfer();
    dropped.items.add(new File([data], "cone.png", { type: "image/png" }));
    return dropped;
  }, readFileSync(CONE).toString("base64"));
  await page.locator(".stage").dispatchEvent("dragover", { dataTransfer: transfer });
  await page.locator(".stage").dispatchEvent("drop", { dataTransfer: transfer });
  await expect(page.getByRole("alert")).toContainText("doesn't contain an Eye-llusion project");
  await expect(layerNames(list)).toHaveText(["Sphere"]);
});

test("a project PNG dropped on a layer row is opened", async ({ page, context, isMobile }) => {
  test.skip(isMobile, "Dragging files is a desktop gesture");
  const { list } = await openLayers(page);
  await page.getByRole("button", { name: "Add text" }).click();
  await expect(layerNames(list)).toHaveText(["Text", "Sphere"]);
  await toolbarAction(page, "Save");
  const dialog = page.getByRole("dialog", { name: "Save PNG" });
  await dialog.getByRole("radio", { name: "Custom" }).check();
  const width = dialog.getByRole("spinbutton", { name: "Width" });
  await width.fill("320");
  await width.press("Tab");
  const downloading = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "Download" }).click();
  const bytes = readFileSync(await (await downloading).path());

  const opened = await context.newPage();
  const reopened = await openLayers(opened);
  await expect(layerNames(reopened.list)).toHaveText(["Sphere"]);
  await reopened.list
    .locator(".layer-row")
    .first()
    .evaluate((row, base64: string) => {
      const data = Uint8Array.from(atob(base64), (char) => char.codePointAt(0) ?? 0);
      const transfer = new DataTransfer();
      transfer.items.add(new File([data], "scene.png", { type: "image/png" }));
      for (const type of ["dragenter", "dragover", "drop"]) {
        row.dispatchEvent(
          new DragEvent(type, { dataTransfer: transfer, bubbles: true, cancelable: true }),
        );
      }
    }, bytes.toString("base64"));
  await expect(layerNames(reopened.list)).toHaveText(["Text", "Sphere"]);
});
