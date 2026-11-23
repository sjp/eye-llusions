import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const SCRIPT = fileURLToPath(new URL("unused-exports.mjs", import.meta.url));
const FIXTURE = fileURLToPath(new URL("fixtures/unused-exports", import.meta.url));

await test("reports exactly the unused exports, ignoring comment markers in strings", () => {
  const result = spawnSync(process.execPath, [SCRIPT, FIXTURE], { encoding: "utf8" });
  assert.equal(result.status, 1);
  assert.deepEqual(result.stderr.trim().split("\n"), [
    "Unused exports (2):",
    "  scripts/fixtures/unused-exports/patterns.mjs: hidden",
    "  scripts/fixtures/unused-exports/values.mjs: unused",
  ]);
});
