import { describe, expect, test, vi } from "vitest";
import {
  createPreviewScheduler,
  EXPORT_MAX_PIXELS,
  EXPORT_MIN_WIDTH,
  EXPORT_PRESETS,
  exportSizeForWidth,
  maxExportWidth,
  presetExportSize,
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

describe("export sizes", () => {
  test("fit the preset box at the picture's aspect", () => {
    const hd = EXPORT_PRESETS[1];
    expect(presetExportSize(16 / 9, hd)).toEqual({ width: 1920, height: 1080 });
    expect(presetExportSize(1, hd)).toEqual({ width: 1080, height: 1080 });
    expect(presetExportSize(2, hd)).toEqual({ width: 1920, height: 960 });
  });

  test("turn the box for portrait pictures", () => {
    const phone = EXPORT_PRESETS[0];
    expect(presetExportSize(1290 / 2796, phone)).toEqual({ width: 1290, height: 2796 });
    expect(presetExportSize(9 / 16, EXPORT_PRESETS[2])).toEqual({ width: 2160, height: 3840 });
  });

  test("keep every preset within the pixel cap", () => {
    for (const preset of EXPORT_PRESETS) {
      for (const aspect of [0.2, 0.5, 1, 16 / 9, 5]) {
        const { width, height } = presetExportSize(aspect, preset);
        expect(width * height).toBeLessThanOrEqual(EXPORT_MAX_PIXELS);
      }
    }
  });

  test("clamp custom widths to the allowed range", () => {
    expect(exportSizeForWidth(2, 1000)).toEqual({ width: 1000, height: 500 });
    expect(exportSizeForWidth(2, 10)).toEqual({ width: EXPORT_MIN_WIDTH, height: 32 });
    const widest = exportSizeForWidth(16 / 9, 1e9);
    expect(widest.width).toBe(maxExportWidth(16 / 9));
    expect(widest.width * widest.height).toBeLessThanOrEqual(EXPORT_MAX_PIXELS);
    expect(widest.width * widest.height).toBeGreaterThan(EXPORT_MAX_PIXELS * 0.999);
    for (const aspect of [0.2, 1 / 3, 0.7, 1.5, 7 / 3, 5]) {
      const size = exportSizeForWidth(aspect, 1e9);
      expect(size.width * size.height).toBeLessThanOrEqual(EXPORT_MAX_PIXELS);
    }
    expect(exportSizeForWidth(0.2, 64).height).toBe(320);
  });
});
