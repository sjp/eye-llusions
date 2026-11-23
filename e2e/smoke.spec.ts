import { expect, test } from "./guard.ts";

test("the app loads without console errors or CSP violations", async ({ page }) => {
  await page.goto("./", { waitUntil: "networkidle" });
  await expect(page.getByRole("heading", { name: "Eye-llusion" })).toBeVisible();
});

test("the page limits workers and fonts to its own origin and sends no referrer", async ({
  page,
}) => {
  await page.goto("./");
  const policy = await page
    .locator('meta[http-equiv="Content-Security-Policy"]')
    .getAttribute("content");
  expect(policy?.split("; ")).toEqual(
    expect.arrayContaining(["worker-src 'self'", "font-src 'self'"]),
  );
  await expect(page.locator('meta[name="referrer"]')).toHaveAttribute("content", "no-referrer");
});
