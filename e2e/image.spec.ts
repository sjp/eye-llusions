import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { openLayers, renders, settledPixels } from "./preview.ts";

const CONE = new URL("fixtures/cone.png", import.meta.url);

/** Opens Create on the depth view with the default scene replaced by one image layer. */
async function openImage(page: Page) {
  const opened = await openLayers(page);
  const { canvas } = opened;
  let count = await renders(canvas);
  await page.getByRole("radio", { name: "Depth" }).check();
  await settledPixels(canvas, count);
  count = await renders(canvas);
  await page.getByRole("button", { name: "Delete" }).click();
  const empty = await settledPixels(canvas, count);
  await page.getByRole("button", { name: "Add image" }).click();
  await expect(page.getByText("Image missing")).toBeVisible();
  return { ...opened, empty };
}

test("an uploaded image becomes depth that invert and silhouette change", async ({ page }) => {
  const { canvas, empty, violations, errors } = await openImage(page);

  let count = await renders(canvas);
  await page.getByLabel("Image file").setInputFiles(CONE.pathname);
  await expect(page.getByRole("img", { name: "Processed depth" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Replace image" })).toBeVisible();
  const plain = await settledPixels(canvas, count);

  count = await renders(canvas);
  await page.getByRole("checkbox", { name: "Invert" }).check();
  const inverted = await settledPixels(canvas, count);

  count = await renders(canvas);
  await page.getByRole("checkbox", { name: "Silhouette" }).check();
  await expect(page.getByRole("slider", { name: "Cut-off" })).toBeVisible();
  const silhouette = await settledPixels(canvas, count);
  expect(new Set([empty, plain, inverted, silhouette]).size).toBe(4);

  count = await renders(canvas);
  await page.getByRole("checkbox", { name: "Invert" }).uncheck();
  await page.getByRole("checkbox", { name: "Silhouette" }).uncheck();
  expect(await settledPixels(canvas, count)).toBe(plain);

  count = await renders(canvas);
  await page.getByRole("radio", { name: "Stereogram" }).check();
  await settledPixels(canvas, count);
  await expect(canvas).toHaveAttribute("data-output", "stereogram");
  expect(violations).toEqual([]);
  expect(errors).toEqual([]);
});

test("a file that isn't an image shows a message and changes nothing", async ({ page }) => {
  const { violations, errors } = await openImage(page);
  await page.getByLabel("Image file").setInputFiles({
    name: "notes.png",
    mimeType: "image/png",
    buffer: Buffer.from("not really a picture"),
  });
  await expect(page.getByRole("alert")).toHaveText(/couldn't be opened/);
  await expect(page.getByText("Image missing")).toBeVisible();
  expect(violations).toEqual([]);
  expect(errors).toEqual([]);
});

test("dropping an image file onto the layer loads it", async ({ page, isMobile }) => {
  test.skip(isMobile, "Phones choose files with the picker");
  const { canvas, empty, violations, errors } = await openImage(page);
  const count = await renders(canvas);
  const bytes = [...readFileSync(CONE)];
  await page.locator(".image-drop").evaluate((zone, data: number[]) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([new Uint8Array(data)], "cone.png", { type: "image/png" }));
    for (const type of ["dragenter", "dragover", "drop"]) {
      zone.dispatchEvent(
        new DragEvent(type, { dataTransfer: transfer, bubbles: true, cancelable: true }),
      );
    }
  }, bytes);
  await expect(page.getByRole("img", { name: "Processed depth" })).toBeVisible();
  expect(await settledPixels(canvas, count)).not.toBe(empty);
  expect(violations).toEqual([]);
  expect(errors).toEqual([]);
});
