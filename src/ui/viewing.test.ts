import { describe, expect, test } from "vitest";
import { cssPixelsToMillimetres, presetRepeats, STRIP_COMFORT, stripAdvice } from "./viewing.ts";

describe("cssPixelsToMillimetres", () => {
  test("assumes 96 CSS pixels to the inch", () => {
    expect(cssPixelsToMillimetres(96)).toBeCloseTo(25.4);
    expect(cssPixelsToMillimetres(0)).toBe(0);
  });
});

describe("presetRepeats", () => {
  test("aims for the context's target strip width", () => {
    // 1209.4 CSS px is 320 mm: 10 strips of 32 mm, or about 14.5 of 22 mm.
    const width = (320 / 25.4) * 96;
    expect(presetRepeats("monitor", width)).toBe(10);
    expect(presetRepeats("phone", width)).toBe(15);
  });

  test("stays within the recipe's repeat limits", () => {
    expect(presetRepeats("monitor", 10)).toBe(2);
    expect(presetRepeats("phone", 100_000)).toBe(32);
  });
});

describe("stripAdvice", () => {
  test("says nothing inside the comfortable range", () => {
    expect(stripAdvice("phone", STRIP_COMFORT.phone.target, true)).toBeUndefined();
    expect(stripAdvice("monitor", STRIP_COMFORT.monitor.min, false)).toBeUndefined();
    expect(stripAdvice("monitor", STRIP_COMFORT.monitor.max, false)).toBeUndefined();
  });

  test("suggests landscape for a fine pattern on a phone held upright", () => {
    expect(stripAdvice("phone", 5, true)).toMatch(/landscape/);
    expect(stripAdvice("phone", 5, false)).toMatch(/Phone preset/);
  });

  test("suggests zooming on a monitor", () => {
    expect(stripAdvice("monitor", 5, false)).toMatch(/zooming in/);
    expect(stripAdvice("monitor", 80, false)).toMatch(/zooming out/);
    expect(stripAdvice("phone", 80, false)).toMatch(/narrower/);
  });
});
