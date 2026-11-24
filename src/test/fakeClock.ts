import { beforeEach, afterEach, vi } from "vitest";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});
