import { expect, test, type Page } from "@playwright/test";

async function openHarness(page: Page): Promise<{ violations: string[]; errors: string[] }> {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") {
      errors.push(message.text());
    }
  });
  page.on("pageerror", (error) => {
    errors.push(error.message);
  });
  const violations: string[] = [];
  await page.exposeFunction("reportCspViolation", (description: string) => {
    violations.push(description);
  });
  await page.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (event) => {
      void window.reportCspViolation(`${event.effectiveDirective} blocked ${event.blockedURI}`);
    });
  });
  await page.goto("./e2e/render.html");
  await page.waitForFunction(() => "renderHarness" in window);
  return { violations, errors };
}

test("the worker renders the default recipe under the CSP", async ({ page }) => {
  const { violations, errors } = await openHarness(page);

  const stereogram = await page.evaluate(() => window.renderHarness.render("stereogram"));
  expect(stereogram).toMatchObject({ kind: "ImageBitmap", width: 320, height: 180 });
  expect(stereogram.colours).toBeGreaterThan(1);

  const depth = await page.evaluate(() => window.renderHarness.render("depth"));
  expect(depth).toMatchObject({ width: 320, height: 180 });
  expect(depth.colours).toBeGreaterThan(10);

  expect(violations).toEqual([]);
  expect(errors).toEqual([]);
});

test("a burst of 20 renders resolves only the last", async ({ page }) => {
  const { violations, errors } = await openHarness(page);

  const burst = await page.evaluate(() => window.renderHarness.burst(20));
  expect(burst).toEqual({ fulfilled: [19], aborted: 19, otherErrors: [], pending: 0 });

  expect(violations).toEqual([]);
  expect(errors).toEqual([]);
});
