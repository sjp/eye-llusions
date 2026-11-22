import type { Page } from "@playwright/test";

declare global {
  interface Window {
    reportCspViolation: (description: string) => Promise<void>;
  }
}

/** Collects console errors, page errors and CSP violations from now on. */
export async function watchPage(page: Page): Promise<{ violations: string[]; errors: string[] }> {
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
  return { violations, errors };
}
