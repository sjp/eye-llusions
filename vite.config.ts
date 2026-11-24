import { preact } from "@preact/preset-vite";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";
import { configDefaults, defineConfig } from "vitest/config";
import { linkPreview } from "./config/linkPreview.ts";

/**
 * Content-Security-Policy for the built site. GitHub Pages can't send headers, so it
 * goes in a <meta> tag (which can't express frame-ancestors, report-uri or sandbox).
 * The build has no inline scripts and no data: or blob: subresources: uploaded images
 * are decoded with createImageBitmap and drawn to a canvas rather than shown through
 * blob: URLs, and the PNG download is a blob: link navigation, which CSP doesn't
 * govern. script-src also covers the render worker, so it must be a same-origin file.
 * style-src needs no 'unsafe-inline': the UI's inline styles (such as the preview's
 * size) are set through the DOM's style object, which the policy doesn't restrict.
 * Trusted Types block HTML and script strings from reaching the DOM; the only policy,
 * created first thing in src/trustedTypes.ts, passes same-origin script addresses so the
 * workers can start.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self'",
  "font-src 'self'",
  "worker-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
  "require-trusted-types-for 'script'",
  "trusted-types default",
].join("; ");

/**
 * Injects the CSP at build time only. The dev server needs a websocket for HMR
 * (Prefresh), which the production policy forbids.
 */
function contentSecurityPolicy(): Plugin {
  return {
    name: "content-security-policy",
    apply: "build",
    transformIndexHtml: () => [
      {
        tag: "meta",
        attrs: { "http-equiv": "Content-Security-Policy", content: CSP },
        injectTo: "head-prepend",
      },
    ],
  };
}

/**
 * Vite's and Vitest's caches, pinned to the project root. The default is relative to
 * the working directory, so Vitest run from a subfolder with `--config` pointing here
 * would otherwise scatter `node_modules/.vite` folders through `src/`. (Run from a
 * subfolder without `--config`, Vitest finds no config at all; run it from the root.)
 */
export const CACHE_DIR = fileURLToPath(new URL("node_modules/.vite", import.meta.url));

/**
 * The instant every unit test's fake clock starts at (2026-03-14 15:09:26 UTC), so no
 * test depends on when it runs.
 */
const TEST_TIME = Date.UTC(2026, 2, 14, 15, 9, 26);

/** Unit tests that need no DOM, run in Node rather than happy-dom. */
const NODE_TESTS = ["src/core/**/*.test.ts", "src/state/**/*.test.ts"];

/** Kept out of every Vitest run. scripts/ has its own `node --test` tests. */
export const TEST_EXCLUDE = ["**/.claude/**", "e2e/**", "scripts/**"];

// https://vite.dev/config/
export default defineConfig({
  // Relative base so the build works when served from a GitHub Pages
  // project subpath (https://<user>.github.io/<repo>/).
  base: "./",
  cacheDir: CACHE_DIR,
  // No react -> preact/compat aliases: the app imports preact directly, and an alias
  // would hide a stray react import instead of failing the build.
  plugins: [preact({ reactAliasesEnabled: false }), contentSecurityPolicy(), linkPreview()],
  // Module workers keep the render worker a single same-origin file.
  worker: { format: "es" },
  // Never inline assets such as fonts as data: URLs, which the CSP blocks.
  build: { assetsInlineLimit: 0 },
  // Agent worktrees live under .claude/; keep their copies of the tests out of the run.
  // e2e/ is reserved for Playwright browser tests, and *.perf.test.ts holds the
  // frame-timing tests, run one file at a time by `npm run test:perf`.
  // src/test/fakeClock.ts puts every test on fake timers starting at TEST_TIME.
  test: {
    exclude: [...configDefaults.exclude, ...TEST_EXCLUDE, "**/*.perf.test.ts"],
    fakeTimers: { now: TEST_TIME },
    // The DOM-free core and state tests skip happy-dom, whose setup costs more than
    // most of their tests.
    projects: [
      {
        extends: true,
        test: {
          name: "node",
          include: NODE_TESTS,
          environment: "node",
          setupFiles: ["src/test/fakeClock.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "dom",
          exclude: NODE_TESTS,
          environment: "happy-dom",
          setupFiles: ["src/test/fakeClock.ts", "src/test/cleanup.ts"],
        },
      },
    ],
    // `npm run test:coverage` fails if the pure core or the state layer loses coverage. It
    // runs with a longer timeout, as instrumentation slows the heaviest tests several times.
    coverage: {
      provider: "v8",
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["**/*.test.{ts,tsx}", "src/test/**"],
      reporter: ["text-summary", "html"],
      thresholds: {
        "src/core/**": { statements: 97, branches: 90, functions: 95, lines: 97 },
        "src/state/**": { statements: 95, branches: 90, functions: 95, lines: 95 },
      },
    },
  },
});
