import { AxeBuilder } from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { expect, test } from "./guard.ts";
import { openLayers, toolbarAction } from "./preview.ts";

test.skip(
  ({ browserName, isMobile }) => browserName !== "chromium" || isMobile,
  "Checked in desktop Chromium only",
);

/** Fails on any WCAG 2.1 A or AA violation axe finds. */
async function expectAccessible(page: Page) {
  const { violations } = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  const summary = violations.map(
    ({ id, nodes }) => `${id}: ${nodes.map((node) => node.target.join(" ")).join(", ")}`,
  );
  expect(summary).toEqual([]);
}

test("the gallery has no accessibility violations", async ({ page }) => {
  await page.goto("./");
  await expect(page.getByRole("img", { name: /stereogram$/ }).first()).toHaveAttribute(
    "data-ready",
    "true",
  );
  await expectAccessible(page);
});

test("Create, with each kind of layer, has no accessibility violations", async ({ page }) => {
  await openLayers(page);
  await expectAccessible(page);
  for (const name of ["Add text", "Add drawing", "Add image"]) {
    await page.getByRole("button", { name }).click();
    await expectAccessible(page);
  }
  await page.getByRole("radio", { name: "Custom" }).check();
  await expectAccessible(page);
});

test("the viewer and its instructions have no accessibility violations", async ({ page }) => {
  await openLayers(page);
  await page.getByRole("button", { name: "View" }).click();
  const viewer = page.getByRole("dialog", { name: "Viewer" });
  await expect(viewer.locator(".preview-canvas")).toHaveAttribute("data-quality", "full");
  await expect(page.getByRole("region", { name: "How to view" })).toBeVisible();
  await expectAccessible(page);
  await page.getByRole("button", { name: "Got it" }).click();
  await expectAccessible(page);
});

test("the share, save and leave dialogs have no accessibility violations", async ({ page }) => {
  await openLayers(page);
  await page.getByRole("button", { name: "New seed" }).click();
  for (const [action, name] of [
    ["Share", "Share"],
    ["Save", "Save PNG"],
  ] as const) {
    await toolbarAction(page, action);
    const dialog = page.getByRole("dialog", { name });
    await expect(dialog).toBeVisible();
    await expectAccessible(page);
    await dialog.getByRole("button", { name: "Close" }).click();
  }
  await page.getByRole("button", { name: "Gallery" }).click();
  await expect(page.getByRole("dialog", { name: "Leave this scene?" })).toBeVisible();
  await expectAccessible(page);
});
