import { expect, test } from "@playwright/test";

declare global {
  interface Window {
    reportCspViolation: (description: string) => Promise<void>;
  }
}

test("the app loads without console errors or CSP violations", async ({ page }) => {
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

  await page.goto("./", { waitUntil: "networkidle" });
  await expect(page.getByRole("heading", { name: "Eye-llusion" })).toBeVisible();

  expect(violations).toEqual([]);
  expect(errors).toEqual([]);
});
