import { expect, test, type Page } from "@playwright/test";
import { watchPage } from "./guard.ts";
import { openCreate, toolbarAction } from "./preview.ts";

/** Fails if focus has fallen back to the page itself. */
async function expectFocusKept(page: Page) {
  expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe("BODY");
}

test("the viewer's instructions close to their button, and Escape closes them first", async ({
  page,
}) => {
  const { errors } = await watchPage(page);
  await openCreate(page);
  await page.getByRole("button", { name: "View" }).click();
  const viewer = page.getByRole("dialog", { name: "Viewer" });
  const help = page.getByRole("region", { name: "How to view" });
  const toggle = viewer.getByRole("button", { name: "How to view" });
  await expect(help).toBeVisible();
  await page.getByRole("button", { name: "Got it" }).click();
  await expect(help).toBeHidden();
  await expect(toggle).toBeFocused();

  await toggle.click();
  await expect(help).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(help).toBeHidden();
  await expect(viewer).toBeVisible();
  await expect(toggle).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(viewer).toBeHidden();
  await expect(page.getByRole("button", { name: "View" })).toBeFocused();
  expect(errors).toEqual([]);
});

test("leaving a viewer opened from the gallery focuses the sample's View button", async ({
  page,
}) => {
  await page.goto("./");
  const view = page.getByRole("button", { name: /^View / }).nth(2);
  const name = await view.getAttribute("aria-label");
  await view.click();
  const viewer = page.getByRole("dialog", { name: "Viewer" });
  await expect(viewer).toBeVisible();
  await viewer.getByRole("button", { name: "Exit" }).click();
  await expect(viewer).toBeHidden();
  await expect(page.getByRole("button", { name: name ?? "" })).toBeFocused();
});

test("moving between the gallery and Create focuses each screen's heading", async ({ page }) => {
  await page.goto("./");
  const heading = page.getByRole("heading", { level: 1 });
  await page
    .getByRole("button", { name: /^Remix / })
    .first()
    .click();
  await expect(page.getByRole("button", { name: "Gallery" })).toBeVisible();
  await expect(heading).toBeFocused();

  await page.getByRole("button", { name: "Gallery" }).click();
  await expect(page.getByRole("button", { name: "Start from blank" })).toBeVisible();
  await expect(heading).toBeFocused();

  await page.getByRole("button", { name: "Start from blank" }).click();
  await expect(page.getByRole("button", { name: "Gallery" })).toBeVisible();
  await expect(heading).toBeFocused();
});

test("closing the leave, share and save dialogs returns focus to the toolbar", async ({ page }) => {
  await openCreate(page);
  await expect(page.locator(".preview-canvas")).toHaveAttribute("data-quality", "full");
  const handle = page.getByRole("button", { name: "Controls" });
  if (await handle.isVisible()) {
    await handle.click();
  }
  await page.getByRole("button", { name: "New seed" }).click();

  const gallery = page.getByRole("button", { name: "Gallery" });
  await gallery.click();
  await page.getByRole("button", { name: "Keep editing" }).click();
  await expect(page.getByRole("dialog", { name: "Leave this scene?" })).toBeHidden();
  await expect(gallery).toBeFocused();

  const more = page.getByRole("button", { name: "More" });
  const compact = await more.isVisible();
  await toolbarAction(page, "Share");
  const share = page.getByRole("dialog", { name: "Share" });
  await share.getByRole("button", { name: "Close" }).click();
  await expect(share).toBeHidden();
  await expect(
    compact ? more : page.getByRole("button", { name: "Share", exact: true }),
  ).toBeFocused();

  await toolbarAction(page, "Save");
  const save = page.getByRole("dialog", { name: "Save PNG" });
  await save.getByRole("button", { name: "Close" }).click();
  await expect(save).toBeHidden();
  await expect(
    compact ? more : page.getByRole("button", { name: "Save", exact: true }),
  ).toBeFocused();
  await expectFocusKept(page);
});
