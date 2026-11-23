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

test.describe("Trusted Types", () => {
  // Browsers log the blocked assignment as an error.
  test.use({ consoleErrors: "allow" });

  test("keep HTML strings out of the page", async ({ page, guard }) => {
    await page.goto("./");
    const thrown = await page.evaluate(() => {
      try {
        document.body.insertAdjacentHTML("beforeend", "<b>injected</b>");
        return "nothing";
      } catch (error) {
        return error instanceof Error ? error.name : String(error);
      }
    });
    expect(thrown).toBe("TypeError");
    await expect
      .poll(() => guard.violations)
      .toEqual([expect.stringMatching(/^require-trusted-types-for/)]);
    // The violation was the point of the test.
    guard.violations.length = 0;
  });
});
