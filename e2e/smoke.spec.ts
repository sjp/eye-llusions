import { expect, test } from "@playwright/test";
import { watchPage } from "./guard.ts";

test("the app loads without console errors or CSP violations", async ({ page }) => {
  const { violations, errors } = await watchPage(page);

  await page.goto("./", { waitUntil: "networkidle" });
  await expect(page.getByRole("heading", { name: "Eye-llusion" })).toBeVisible();

  expect(violations).toEqual([]);
  expect(errors).toEqual([]);
});
