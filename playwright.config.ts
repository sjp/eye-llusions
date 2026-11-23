import { defineConfig, devices } from "@playwright/test";

/** Not Vite's default preview port, so a manual `npm run preview` doesn't clash. */
const PORT = 4174;
const CI = process.env["CI"] !== undefined;
/**
 * An existing build to serve as is, such as the `dist/` CI is about to deploy. Without
 * it the app is built into its own folder, so a test run never replaces `dist/`.
 */
const PREBUILT_DIR = process.env["E2E_DIST"];
const OUT_DIR = PREBUILT_DIR ?? "dist-e2e";
const PREVIEW = `npx vite preview --outDir ${OUT_DIR} --port ${String(PORT)} --strictPort`;

// The tests run against the production build, so they see the real CSP.
export default defineConfig({
  testDir: "e2e",
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  reporter: CI ? [["github"], ["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://localhost:${String(PORT)}/`,
    trace: "on-first-retry",
  },
  projects: [
    { name: "desktop-chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "desktop-firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "mobile-chromium", use: { ...devices["Pixel 7"] } },
    { name: "mobile-webkit", use: { ...devices["iPhone 15"] } },
  ],
  webServer: {
    command:
      PREBUILT_DIR === undefined ? `npm run build -- --outDir ${OUT_DIR} && ${PREVIEW}` : PREVIEW,
    url: `http://localhost:${String(PORT)}/`,
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
