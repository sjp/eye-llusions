import { defineConfig, devices } from "@playwright/test";

/** Not Vite's default preview port, so a manual `npm run preview` doesn't clash. */
const PORT = 4174;
const CI = process.env["CI"] !== undefined;
/** Built separately so a test run never replaces the deployable `dist/`. */
const OUT_DIR = "dist-e2e";

// The tests run against the production build, so they see the real CSP.
export default defineConfig({
  testDir: "e2e",
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  reporter: CI ? [["github"], ["list"]] : "list",
  use: {
    baseURL: `http://localhost:${String(PORT)}/`,
    trace: "on-first-retry",
  },
  projects: [
    { name: "desktop-chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile-chromium", use: { ...devices["Pixel 7"] } },
    { name: "mobile-webkit", use: { ...devices["iPhone 15"] } },
  ],
  webServer: {
    command: `npm run build -- --outDir ${OUT_DIR} && npx vite preview --outDir ${OUT_DIR} --port ${String(PORT)} --strictPort`,
    url: `http://localhost:${String(PORT)}/`,
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
