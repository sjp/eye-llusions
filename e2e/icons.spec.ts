import type { APIResponse, Page } from "@playwright/test";
import { expect, test } from "./guard.ts";

/** The width and height in a PNG's header. */
async function pngSize(response: APIResponse): Promise<[number, number]> {
  expect(response.ok()).toBe(true);
  const bytes = await response.body();
  expect(bytes.subarray(1, 4).toString("latin1")).toBe("PNG");
  return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
}

type Icon = { src: string; sizes: string; type: string };

function isIcon(value: unknown): value is Icon {
  return (
    typeof value === "object" &&
    value !== null &&
    "src" in value &&
    typeof value.src === "string" &&
    "sizes" in value &&
    typeof value.sizes === "string" &&
    "type" in value &&
    typeof value.type === "string"
  );
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

test("the web app manifest names the app and its icons load", async ({ page }) => {
  await page.goto("./");
  const manifestUrl = await linkHref(page, "manifest");
  const response = await page.request.get(manifestUrl);
  expect(response.ok()).toBe(true);
  const manifest: unknown = await response.json();
  expect(manifest).toMatchObject({ name: "Eye-llusion", start_url: "./", display: "standalone" });
  const icons: unknown =
    typeof manifest === "object" && manifest !== null && "icons" in manifest ? manifest.icons : [];
  if (!Array.isArray(icons)) {
    throw new TypeError("The manifest has no icon list");
  }
  const sizes = [];
  for (const icon of icons as unknown[]) {
    if (!isIcon(icon)) {
      throw new TypeError(`Not an icon: ${JSON.stringify(icon)}`);
    }
    const iconResponse = await page.request.get(new URL(icon.src, manifestUrl).href);
    if (icon.type === "image/png") {
      const [width, height] = await pngSize(iconResponse);
      expect(`${String(width)}x${String(height)}`).toBe(icon.sizes);
      sizes.push(width);
    } else {
      expect(iconResponse.ok()).toBe(true);
    }
  }
  expect(sizes).toEqual(expect.arrayContaining([192, 512]));
});

test("Chromium reads the manifest without errors", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "The manifest parser is checked through Chromium");
  await page.goto("./");
  const session = await page.context().newCDPSession(page);
  const { url, errors } = await session.send("Page.getAppManifest");
  expect(url).toMatch(/manifest\.webmanifest$/);
  expect(errors).toEqual([]);
});
