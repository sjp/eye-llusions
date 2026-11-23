import { expect, type Locator, type Page } from "@playwright/test";
import { watchPage } from "./guard.ts";

/** Opens a share link's `#r=…` fragment, or else the gallery and then a blank scene. */
export async function openCreate(page: Page, hash = "") {
  await page.goto(`./${hash}`);
  if (hash === "") {
    await page.getByRole("button", { name: "Start from blank" }).click();
  }
}

/** Opens the Create screen, or a share link's `#r=…` fragment, with the controls showing. */
export async function openLayers(page: Page, hash = "") {
  const watched = await watchPage(page);
  await openCreate(page, hash);
  const canvas = page.locator(".preview-canvas");
  await expect(canvas).toHaveAttribute("data-quality", "full");
  const handle = page.getByRole("button", { name: "Controls" });
  if (await handle.isVisible()) {
    await handle.click();
  }
  const list = page.getByRole("list", { name: "Layer stack, top first" });
  return { ...watched, canvas, list };
}

/** Layer names as listed, top first. */
export function layerNames(list: Locator) {
  return list.locator(".layer-name");
}

/** A checksum of the canvas pixels, read once the next full render has been drawn. */
export async function settledPixels(canvas: Locator, after: number): Promise<number> {
  await expect
    .poll(async () => Number(await canvas.getAttribute("data-renders")))
    .toBeGreaterThan(after);
  // Let follow-up renders, such as those for the sheet resizing the preview, finish.
  let seen = "";
  await expect
    .poll(
      async () => {
        const now = `${String(await renders(canvas))}:${String(await canvas.getAttribute("data-quality"))}`;
        const quiet = now === seen && now.endsWith(":full");
        seen = now;
        return quiet;
      },
      { intervals: [250] },
    )
    .toBe(true);
  return canvas.evaluate((element: HTMLCanvasElement) => {
    const context = element.getContext("2d");
    if (context === null) {
      throw new Error("No 2D context");
    }
    const { data } = context.getImageData(0, 0, element.width, element.height);
    let hash = 0x811c9dc5;
    for (let i = 0; i < data.length; i += 4) {
      hash = Math.imul(hash ^ data[i], 0x01000193);
    }
    return hash;
  });
}

export async function renders(canvas: Locator): Promise<number> {
  return Number(await canvas.getAttribute("data-renders"));
}

/** Runs a toolbar action, through the More menu on screens too narrow to show it directly. */
export async function toolbarAction(page: Page, name: "Open" | "Save" | "Share") {
  const more = page.getByRole("button", { name: "More" });
  if (await more.isVisible()) {
    await more.click();
    await page.getByRole("menuitem", { name }).click();
  } else {
    await page.getByRole("button", { name, exact: true }).click();
  }
}
