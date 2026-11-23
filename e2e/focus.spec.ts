import { expect, test } from "@playwright/test";
import { watchPage } from "./guard.ts";
import { openCreate } from "./preview.ts";

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
