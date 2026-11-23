import { readFileSync } from "node:fs";
import type { Page } from "@playwright/test";
import { expect, test } from "./guard.ts";
import { openLayers, toolbarAction } from "./preview.ts";

test.skip(
  ({ browserName, isMobile }) => browserName !== "chromium" || isMobile,
  "Compared in desktop Chromium only",
);

const FONT = readFileSync(
  new URL("../src/assets/fonts/archivo-black/archivo-black-latin.woff2", import.meta.url),
);
const STYLE = readFileSync(new URL("screenshots/font.css", import.meta.url));

test.beforeEach(async ({ page }) => {
  // System fonts differ between machines, so the chrome is drawn in a bundled font, from
  // same-origin files the CSP allows.
  await page.route("**/screenshot-font.woff2", (route) =>
    route.fulfill({ body: FONT, contentType: "font/woff2" }),
  );
  await page.route("**/screenshot-font.css", (route) =>
    route.fulfill({ body: STYLE, contentType: "text/css" }),
  );
  await page.setViewportSize({ width: 1280, height: 800 });
});

/** Loads the bundled font in place of the system one. */
async function applyBundledFont(page: Page) {
  await page.evaluate(async () => {
    if (document.getElementById("screenshot-font") === null) {
      const link = document.createElement("link");
      link.id = "screenshot-font";
      link.rel = "stylesheet";
      link.href = "/screenshot-font.css";
      document.head.append(link);
      await new Promise((resolve) => {
        link.addEventListener("load", resolve);
      });
    }
    await document.fonts.load('16px "Screenshot Sans"');
  });
}

/**
 * Compares the page with its baseline. The generated pictures are hidden rather than
 * masked, as masks would cover the instructions and dialogs drawn over them.
 */
async function expectScreen(page: Page, name: string) {
  await applyBundledFont(page);
  await page.locator("canvas").evaluateAll((canvases: HTMLCanvasElement[]) => {
    for (const canvas of canvases) {
      canvas.style.visibility = "hidden";
    }
  });
  // A little slack for anti-aliasing that differs between machines.
  await expect(page).toHaveScreenshot(name, {
    animations: "disabled",
    caret: "hide",
    maxDiffPixelRatio: 0.001,
  });
}

test("the gallery looks the same", async ({ page }) => {
  await page.goto("./");
  await expect(page.getByRole("button", { name: "Start from blank" })).toBeVisible();
  await expectScreen(page, "gallery.png");
});

test("Create and its share and leave dialogs look the same", async ({ page }) => {
  await openLayers(page);
  await expectScreen(page, "create.png");
  await toolbarAction(page, "Share");
  const share = page.getByRole("dialog", { name: "Share" });
  await expect(share).toBeVisible();
  await expectScreen(page, "share.png");
  await share.getByRole("button", { name: "Close" }).click();

  await page.getByRole("button", { name: "New seed" }).click();
  await page.getByRole("button", { name: "Gallery" }).click();
  await expect(page.getByRole("dialog", { name: "Leave this scene?" })).toBeVisible();
  await expectScreen(page, "leave.png");
});

test("the viewer looks the same", async ({ page }) => {
  await openLayers(page);
  await page.getByRole("button", { name: "View" }).click();
  const viewer = page.getByRole("dialog", { name: "Viewer" });
  await expect(viewer.locator(".preview-canvas")).toHaveAttribute("data-quality", "full");
  await expectScreen(page, "viewer.png");
});
