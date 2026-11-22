import { describe, expect, test } from "vitest";
import { defaultRecipe, type Asset, type TextureSpec } from "../recipe.ts";
import { renderStereogram } from "../stereogram.ts";
import { buildSampler } from "./sampler.ts";

const DOTS: TextureSpec = {
  generator: { type: "randomDots", density: 0.5 },
  palette: { type: "custom", stops: ["#102030", "#ffeedd"] },
  scale: 1,
  seed: 0,
};
const NOISE: TextureSpec = {
  generator: { type: "colourNoise" },
  palette: { type: "preset", id: "ocean" },
  scale: 1,
  seed: 0,
};

function sampler(
  texture: TextureSpec,
  seed: number,
  width: number,
  height: number,
  assets: Record<string, Asset> = {},
) {
  return buildSampler({ ...defaultRecipe(), texture, seed, assets }, width, height);
}

function row(sample: (x: number, y: number) => number, y = 0, width = 400): number[] {
  return Array.from({ length: width }, (_, x) => sample(x, y));
}

describe("buildSampler", () => {
  test.each([DOTS, NOISE])("is deterministic per seed", (texture) => {
    expect(row(sampler(texture, 1, 400, 300))).toEqual(row(sampler(texture, 1, 400, 300)));
    expect(row(sampler(texture, 1, 400, 300))).not.toEqual(row(sampler(texture, 2, 400, 300)));
  });

  test("reshuffles with the texture seed alone", () => {
    const base = row(sampler(NOISE, 1, 400, 300));
    const reshuffled = row(sampler({ ...NOISE, seed: 5 }, 1, 400, 300));
    expect(reshuffled).not.toEqual(base);
    expect(row(sampler({ ...NOISE, seed: 5 }, 1, 400, 300))).toEqual(reshuffled);
  });

  test("colours random dots with the palette's end stops", () => {
    expect(new Set(row(sampler(DOTS, 1, 400, 300)))).toEqual(new Set([0x102030ff, 0xffeeddff]));
  });

  test("maps noise through the palette", () => {
    const colours = new Set(row(sampler(NOISE, 1, 400, 300)));
    expect(colours.size).toBeGreaterThan(50);
    expect(colours).toContain(0x031a33ff);
    for (const colour of colours) {
      expect(colour & 0xff).toBe(0xff);
    }
  });

  test("scales feature size with the image height and scale", () => {
    const featureWidth = (texture: TextureSpec, height: number) => {
      const values = row(sampler(texture, 3, 2000, height), 0, 2000);
      const changes = values.slice(1).filter((value, i) => value !== values[i]).length;
      return Math.round(values.length / (changes + 1));
    };
    expect(featureWidth(NOISE, 400)).toBe(1);
    expect(featureWidth(NOISE, 1600)).toBe(4);
    expect(featureWidth({ ...NOISE, scale: 2 }, 1600)).toBe(8);
  });

  test("never uses features smaller than a pixel", () => {
    const sample = sampler({ ...NOISE, scale: 0.1 }, 3, 400, 100);
    for (let x = 0; x < 100; x++) {
      expect(sample(x + 0.5, 7)).toBe(sample(x, 7));
    }
  });
});

describe("with the stereogram renderer", () => {
  test("renders a texture with the palette's colours", () => {
    const width = 320;
    const height = 120;
    const depth = new Float32Array(width * height);
    for (let y = 40; y < 80; y++) {
      depth.fill(1, y * width + 120, y * width + 200);
    }
    const image = renderStereogram({
      depth,
      width,
      height,
      repeats: 8,
      depthOfField: 1 / 3,
      mode: "wall",
      oversample: 1,
      sample: sampler(DOTS, 9, width, height),
    });
    const colours = new Set<number>();
    for (let i = 0; i < image.length; i += 4) {
      colours.add(
        ((image[i] << 24) | (image[i + 1] << 16) | (image[i + 2] << 8) | image[i + 3]) >>> 0,
      );
    }
    expect(colours).toEqual(new Set([0x102030ff, 0xffeeddff]));
  });
});

describe("with a tile", () => {
  // Columns of increasing grey, so a sample's column can be read off its colour.
  const ramp: Asset = {
    format: "gray",
    width: 64,
    height: 16,
    data: new Uint8Array(Array.from({ length: 64 * 16 }, (_, i) => (i % 64) * 4)),
  };
  const tile = (divisions = 1, jitter = 0): TextureSpec => ({
    ...DOTS,
    generator: { type: "tile", asset: "tile-1", divisions, jitter },
  });
  // 8 repeats over 256 pixels make a 32-pixel strip.
  const sampleTile = (texture: TextureSpec, seed = 1) =>
    sampler(texture, seed, 256, 96, { "tile-1": ramp });

  test("fits copies of the tile exactly across each strip", () => {
    for (const divisions of [1, 2, 4]) {
      const period = 32 / divisions;
      const values = row(sampleTile(tile(divisions)), 0, 256);
      for (let x = period; x < 256; x++) {
        expect(values[x]).toBe(values[x - period]);
      }
      expect(new Set(values.slice(0, period)).size).toBe(period);
    }
  });

  test("keeps the tile's colours and ignores the palette", () => {
    const values = row(sampleTile(tile()), 0, 32);
    expect(values[0]).toBe(0x020202ff);
    expect(values[31]).toBe(0xfafafaff);
  });

  test("shifts each row of tiles by a seeded amount", () => {
    // The 64×16 tile fits a 32-pixel strip at 8 pixels tall.
    const sample = sampleTile(tile());
    const shifts = new Set<number>();
    for (let band = 0; band < 12; band++) {
      const values = row(sample, band * 8, 32);
      expect(row(sample, band * 8 + 7, 32)).toEqual(values);
      shifts.add(values.indexOf(values.reduce((a, b) => Math.min(a, b))));
    }
    expect(shifts.size).toBeGreaterThan(4);
    expect(row(sampleTile(tile(), 2), 40, 32)).not.toEqual(row(sample, 40, 32));
  });

  test("jitter adds seeded noise that grows with the amount", () => {
    const flat: Asset = { format: "gray", width: 4, height: 4, data: new Uint8Array(16).fill(128) };
    const spread = (jitter: number) => {
      const values = row(sampler(tile(1, jitter), 1, 256, 96, { "tile-1": flat }), 3, 256).map(
        (colour) => colour >>> 24,
      );
      return Math.max(...values) - Math.min(...values);
    };
    expect(spread(0)).toBe(0);
    expect(spread(0.2)).toBeGreaterThan(10);
    expect(spread(1)).toBeGreaterThan(spread(0.2) * 3);
  });

  test("falls back to random dots in the palette while the tile is missing", () => {
    expect(new Set(row(sampler(tile(), 1, 400, 300)))).toEqual(new Set([0x102030ff, 0xffeeddff]));
  });
});
