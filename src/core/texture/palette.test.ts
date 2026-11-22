import { describe, expect, test } from "vitest";
import {
  MIN_LUMINANCE_SPREAD,
  PALETTE_LEVELS,
  PALETTE_PRESETS,
  luminanceSpread,
  paletteTable,
} from "./palette.ts";

describe("paletteTable", () => {
  test("maps 0 and 1 to the first and last stops, opaque", () => {
    const table = paletteTable({ type: "custom", stops: ["#102030", "#a0b0c0", "#f0e0d0"] });
    expect(table).toHaveLength(PALETTE_LEVELS);
    expect(table[0]).toBe(0x102030ff);
    expect(table[PALETTE_LEVELS - 1]).toBe(0xf0e0d0ff);
  });

  test("interpolates linearly between stops", () => {
    const table = paletteTable({ type: "custom", stops: ["#000000", "#ff0000"] });
    expect(table[51]).toBe(0x330000ff);
    expect(table[204]).toBe(0xcc0000ff);
  });

  test("passes through a middle stop", () => {
    const table = paletteTable({ type: "custom", stops: ["#000000", "#00ff00", "#000000"] });
    const peak = Math.max(...Array.from(table, (colour) => (colour >>> 16) & 0xff));
    expect(peak).toBeGreaterThanOrEqual(0xfe);
  });

  test("uses the preset's stops", () => {
    const table = paletteTable({ type: "preset", id: "mono" });
    expect(table[0]).toBe(0x000000ff);
    expect(table[PALETTE_LEVELS - 1]).toBe(0xffffffff);
  });

  test.each(["no-such-preset", "constructor"])("falls back to mono for preset %s", (id) => {
    expect(paletteTable({ type: "preset", id })).toEqual(
      paletteTable({ type: "preset", id: "mono" }),
    );
  });
});

describe("luminanceSpread", () => {
  test("is 1 for black to white and 0 for a single colour", () => {
    expect(luminanceSpread({ type: "custom", stops: ["#000000", "#ffffff"] })).toBeCloseTo(1, 6);
    expect(luminanceSpread({ type: "custom", stops: ["#336699", "#336699"] })).toBe(0);
  });

  test("measures lightness rather than hue", () => {
    expect(luminanceSpread({ type: "custom", stops: ["#ff0000", "#7f7f7f"] })).toBeLessThan(0.1);
  });

  test("includes colours between stops", () => {
    const spread = luminanceSpread({ type: "custom", stops: ["#ffffff", "#000000", "#ffffff"] });
    expect(spread).toBeCloseTo(1, 2);
  });
});

describe("presets", () => {
  test("there are at least six", () => {
    expect(Object.keys(PALETTE_PRESETS).length).toBeGreaterThanOrEqual(6);
  });

  test.each(Object.keys(PALETTE_PRESETS))("%s has a usable lightness spread", (id) => {
    expect(luminanceSpread({ type: "preset", id })).toBeGreaterThanOrEqual(MIN_LUMINANCE_SPREAD);
  });

  test.each(Object.entries(PALETTE_PRESETS))("%s stops are valid colours", (_, stops) => {
    expect(stops.length).toBeGreaterThanOrEqual(2);
    for (const stop of stops) {
      expect(stop).toMatch(/^#[\da-f]{6}$/);
    }
  });
});
