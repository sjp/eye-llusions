import { describe, expect, test } from "vitest";
import { defaultRecipe, type Recipe, type TextureGenerator } from "../recipe.ts";
import { BASE_CELL, FEATURE_CELLS, clampScale, scaleLimits } from "./scale.ts";

const TYPES = Object.keys(FEATURE_CELLS) as TextureGenerator["type"][];

describe("scaleLimits", () => {
  test.each(TYPES)("keeps %s features between 1/200 and 1/5 of a strip", (type) => {
    const aspect = 1.5;
    const repeats = 10;
    const strip = aspect / repeats;
    const { min, max } = scaleLimits(type, aspect, repeats);
    expect(min * BASE_CELL).toBeCloseTo(strip / 200, 9);
    expect(max * BASE_CELL * FEATURE_CELLS[type]).toBeCloseTo(strip / 5, 9);
    expect(min).toBeLessThan(max);
  });

  test("scale with the strip width", () => {
    const narrow = scaleLimits("cells", 16 / 9, 16);
    const wide = scaleLimits("cells", 16 / 9, 8);
    expect(wide.min).toBeCloseTo(narrow.min * 2, 9);
    expect(wide.max).toBeCloseTo(narrow.max * 2, 9);
  });

  test.each(TYPES)("include scale 1 for %s in the default view", (type) => {
    const { aspect, view } = defaultRecipe();
    const { min, max } = scaleLimits(type, aspect, view.repeats);
    expect(min).toBeLessThan(1);
    expect(max).toBeGreaterThan(1);
  });
});

describe("clampScale", () => {
  const withScale = (scale: number): Recipe => {
    const recipe = defaultRecipe();
    return { ...recipe, texture: { ...recipe.texture, scale } };
  };

  test("returns the recipe itself when the scale is in range", () => {
    const recipe = withScale(1);
    expect(clampScale(recipe)).toBe(recipe);
  });

  test.each([0.01, 1000])("clamps %f into range", (scale) => {
    const { aspect, view, texture } = defaultRecipe();
    const { min, max } = scaleLimits(texture.generator.type, aspect, view.repeats);
    const clamped = clampScale(withScale(scale)).texture.scale;
    expect(clamped).toBe(scale < 1 ? min : max);
  });
});
