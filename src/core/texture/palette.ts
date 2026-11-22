import type { Palette } from "../recipe.ts";

/**
 * Built-in palettes as `#rrggbb` stops, evenly spaced from value 0 to value 1. Each runs
 * from dark to light, because stereograms fuse on brightness contrast more than on hue.
 */
export const PALETTE_PRESETS: Readonly<Record<string, readonly string[]>> = {
  mono: ["#000000", "#ffffff"],
  neon: ["#0b0221", "#ff00a0", "#00f0ff", "#f8ff40"],
  ocean: ["#031a33", "#0a4f7a", "#1fa2c2", "#9be7f0"],
  autumn: ["#2b0f05", "#8a2c0a", "#d9741c", "#f6d27a"],
  pastel: ["#6b5b95", "#f7a8b8", "#a8e6cf", "#fff5ba"],
  forest: ["#0f2310", "#2e5a1c", "#7a9a3a", "#d8e0a0"],
};

/** Used for preset IDs this version doesn't know, such as ones from a newer version. */
const FALLBACK_STOPS = ["#000000", "#ffffff"];

/**
 * The smallest `luminanceSpread` that fuses comfortably: 0.4 is 40 units of CIE L*,
 * roughly the gap between mid grey and white.
 */
export const MIN_LUMINANCE_SPREAD = 0.4;

/** Number of entries in a palette lookup table. */
export const PALETTE_LEVELS = 256;

export function paletteStops(palette: Palette): readonly string[] {
  if (palette.type === "custom") {
    return palette.stops;
  }
  return Object.hasOwn(PALETTE_PRESETS, palette.id) ? PALETTE_PRESETS[palette.id] : FALLBACK_STOPS;
}

function parseColour(colour: string): [number, number, number] {
  const value = Number.parseInt(colour.slice(1), 16);
  return [(value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
}

/**
 * The palette's colours at `PALETTE_LEVELS` evenly spaced values from 0 to 1, packed as
 * opaque `0xRRGGBBAA`. Colours between stops are interpolated linearly in sRGB.
 */
export function paletteTable(palette: Palette): Uint32Array {
  const stops = paletteStops(palette).map((stop) => parseColour(stop));
  const table = new Uint32Array(PALETTE_LEVELS);
  const segments = stops.length - 1;
  for (let i = 0; i < PALETTE_LEVELS; i++) {
    const t = (i / (PALETTE_LEVELS - 1)) * segments;
    const k = Math.min(Math.floor(t), segments - 1);
    const f = t - k;
    const from = stops[k] ?? [0, 0, 0];
    const to = stops[k + 1] ?? from;
    const channel = (c: 0 | 1 | 2) => Math.round(from[c] + (to[c] - from[c]) * f);
    table[i] = ((channel(0) << 24) | (channel(1) << 16) | (channel(2) << 8) | 0xff) >>> 0;
  }
  return table;
}

function linear(channel: number): number {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** CIE L* of a packed colour, scaled to 0–1. */
function lightness(packed: number): number {
  const y =
    0.2126 * linear(packed >>> 24) +
    0.7152 * linear((packed >>> 16) & 0xff) +
    0.0722 * linear((packed >>> 8) & 0xff);
  const l = y > 216 / 24_389 ? 116 * Math.cbrt(y) - 16 : (24_389 / 27) * y;
  return l / 100;
}

/**
 * The range of perceptual lightness (CIE L*, scaled to 0–1) across every colour the
 * palette can produce. Low values make stereograms hard to fuse.
 */
export function luminanceSpread(palette: Palette): number {
  let min = 1;
  let max = 0;
  for (const colour of paletteTable(palette)) {
    const l = lightness(colour);
    min = Math.min(min, l);
    max = Math.max(max, l);
  }
  return Math.max(0, max - min);
}
