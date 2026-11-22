import { describe, expect, test, vi } from "vitest";
import {
  createPreviewScheduler,
  DRAFT_SCALE,
  PREVIEW_MAX_PIXELS,
  previewSize,
  SETTLE_DELAY_MS,
} from "./resolution.ts";

describe("previewSize", () => {
  test("fits the box at the device pixel ratio", () => {
    expect(previewSize(2, { width: 400, height: 400 }, 2, "full")).toEqual({
      width: 800,
      height: 400,
    });
    expect(previewSize(0.5, { width: 400, height: 400 }, 1, "full")).toEqual({
      width: 200,
      height: 400,
    });
  });

  test("caps full previews at the pixel budget, keeping the aspect", () => {
    const size = previewSize(16 / 9, { width: 3840, height: 2160 }, 2, "full");
    expect(size.width * size.height).toBeLessThanOrEqual(PREVIEW_MAX_PIXELS);
    expect(size.width * size.height).toBeGreaterThan(PREVIEW_MAX_PIXELS * 0.99);
    expect(size.width / size.height).toBeCloseTo(16 / 9, 2);
  });

  test("scales drafts down from the full size", () => {
    const full = previewSize(16 / 9, { width: 1600, height: 900 }, 1, "full");
    const draft = previewSize(16 / 9, { width: 1600, height: 900 }, 1, "draft");
    expect(draft).toEqual({ width: full.width * DRAFT_SCALE, height: full.height * DRAFT_SCALE });
  });

  test("never returns an empty size", () => {
    expect(previewSize(1, { width: 0, height: 0 }, 1, "draft")).toEqual({ width: 1, height: 1 });
  });
});

describe("createPreviewScheduler", () => {
  test("renders drafts while changing and one full render once settled", () => {
    const render = vi.fn<(quality: string) => void>();
    const scheduler = createPreviewScheduler(render);
    scheduler.change();
    vi.advanceTimersByTime(SETTLE_DELAY_MS - 1);
    scheduler.change();
    vi.advanceTimersByTime(SETTLE_DELAY_MS - 1);
    expect(render.mock.calls).toEqual([["draft"], ["draft"]]);
    vi.advanceTimersByTime(1);
    expect(render.mock.calls).toEqual([["draft"], ["draft"], ["full"]]);
    vi.advanceTimersByTime(SETTLE_DELAY_MS * 10);
    expect(render).toHaveBeenCalledTimes(3);
  });

  test("flush renders in full at once and cancel drops the pending render", () => {
    const render = vi.fn<(quality: string) => void>();
    const scheduler = createPreviewScheduler(render);
    scheduler.change();
    scheduler.flush();
    scheduler.change();
    scheduler.cancel();
    vi.advanceTimersByTime(SETTLE_DELAY_MS * 10);
    expect(render.mock.calls).toEqual([["draft"], ["full"], ["draft"]]);
  });
});
