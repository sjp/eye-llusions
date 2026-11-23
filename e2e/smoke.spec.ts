import { expect, test } from "./guard.ts";

test("the app loads without console errors or CSP violations", async ({ page }) => {
  await page.goto("./", { waitUntil: "networkidle" });
  await expect(page.getByRole("heading", { name: "Eye-llusion" })).toBeVisible();
});
