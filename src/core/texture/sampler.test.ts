import { describe, expect, test } from "vitest";
import type { TextureSpec } from "../recipe.ts";
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

function row(sample: (x: number, y: number) => number, y = 0, width = 400): number[] {
  return Array.from({ length: width }, (_, x) => sample(x, y));
}

describe("buildSampler", () => {
  test.each([DOTS, NOISE])("is deterministic per seed", (texture) => {
    expect(row(buildSampler(texture, 1, 400, 300))).toEqual(
      row(buildSampler(texture, 1, 400, 300)),
    );
    expect(row(buildSampler(texture, 1, 400, 300))).not.toEqual(
      row(buildSampler(texture, 2, 400, 300)),
    );
  });

  test("reshuffles with the texture seed alone", () => {
    const base = row(buildSampler(NOISE, 1, 400, 300));
    const reshuffled = row(buildSampler({ ...NOISE, seed: 5 }, 1, 400, 300));
    expect(reshuffled).not.toEqual(base);
    expect(row(buildSampler({ ...NOISE, seed: 5 }, 1, 400, 300))).toEqual(reshuffled);
  });

  test("colours random dots with the palette's end stops", () => {
    expect(new Set(row(buildSampler(DOTS, 1, 400, 300)))).toEqual(
      new Set([0x102030ff, 0xffeeddff]),
    );
  });

  test("maps noise through the palette", () => {
    const colours = new Set(row(buildSampler(NOISE, 1, 400, 300)));
    expect(colours.size).toBeGreaterThan(50);
    expect(colours).toContain(0x031a33ff);
    for (const colour of colours) {
      expect(colour & 0xff).toBe(0xff);
    }
  });

  test("scales feature size with the image height and scale", () => {
    const featureWidth = (texture: TextureSpec, height: number) => {
      const values = row(buildSampler(texture, 3, 2000, height), 0, 2000);
      const changes = values.slice(1).filter((value, i) => value !== values[i]).length;
      return Math.round(values.length / (changes + 1));
    };
    expect(featureWidth(NOISE, 400)).toBe(1);
    expect(featureWidth(NOISE, 1600)).toBe(4);
    expect(featureWidth({ ...NOISE, scale: 2 }, 1600)).toBe(8);
  });

  test("never uses features smaller than a pixel", () => {
    const sample = buildSampler({ ...NOISE, scale: 0.1 }, 3, 400, 100);
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
      sample: buildSampler(DOTS, 9, width, height),
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
