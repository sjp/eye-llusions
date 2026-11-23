import { expect, test as base, type BrowserContext } from "@playwright/test";

declare global {
  interface Window {
    reportCspViolation: (description: string) => Promise<void>;
  }
}

export interface Watched {
  violations: string[];
  errors: string[];
}

/** Collects console errors, page errors and CSP violations from every page in the context. */
export async function watchContext(context: BrowserContext): Promise<Watched> {
  const watched: Watched = { violations: [], errors: [] };
  context.on("console", (message) => {
    if (message.type() === "error") {
      watched.errors.push(message.text());
    }
  });
  context.on("weberror", (error) => {
    watched.errors.push(error.error().message);
  });
  await context.exposeBinding("reportCspViolation", (_source, description: string) => {
    watched.violations.push(description);
  });
  await context.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (event) => {
      void window.reportCspViolation(`${event.effectiveDirective} blocked ${event.blockedURI}`);
    });
  });
  return watched;
}

/**
 * Playwright's `test`, failing any test whose pages log a console error, throw, or break
 * the CSP, even when the test fails first. `test.use({ consoleErrors: "allow" })` lets
 * console errors through for tests that expect them.
 */
export const test = base.extend<{ consoleErrors: "fail" | "allow"; guard: Watched }>({
  consoleErrors: ["fail", { option: true }],
  guard: [
    async ({ context, consoleErrors }, use) => {
      const watched = await watchContext(context);
      await use(watched);
      expect(watched.violations, "CSP violations").toEqual([]);
      if (consoleErrors === "fail") {
        expect(watched.errors, "console and page errors").toEqual([]);
      }
    },
    { auto: true },
  ],
});

export { expect };
