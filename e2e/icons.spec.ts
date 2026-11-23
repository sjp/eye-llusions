import type { APIResponse, Page } from "@playwright/test";
import { expect, test } from "./guard.ts";

/** The width and height in a PNG's header. */
async function pngSize(response: APIResponse): Promise<[number, number]> {
  expect(response.ok()).toBe(true);
  const bytes = await response.body();
  expect(bytes.subarray(1, 4).toString("latin1")).toBe("PNG");
  return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
}

async function linkHref(page: Page, rel: string): Promise<string> {
  const href = await page.locator(`head link[rel="${rel}"]`).getAttribute("href");
  if (href === null) {
    throw new Error(`The page has no ${rel} link`);
  }
  return new URL(href, page.url()).href;
}

test("the home screen icon is a 180 pixel PNG", async ({ page }) => {
  await page.goto("./");
  expect(await pngSize(await page.request.get(await linkHref(page, "apple-touch-icon")))).toEqual([
    180, 180,
  ]);
});
