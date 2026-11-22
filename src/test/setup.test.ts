import { expect, test } from "vitest";

test("every test starts on the fake clock at a fixed instant", () => {
  expect(Date.now()).toBe(Date.UTC(2026, 2, 14, 15, 9, 26));
});
