import { describe, expect, test } from "vitest";
import { FIGURE_IDS } from "../../core/depth/figure.ts";
import { uncoveredCharacters } from "../../core/fonts.ts";
import { parseRecipe } from "../../core/parseRecipe.ts";
import { luminanceSpread, MIN_LUMINANCE_SPREAD } from "../../core/texture/palette.ts";
import { GALLERY } from "./samples.ts";

describe("GALLERY", () => {
  test("has a handful of samples with unique IDs", () => {
    expect(GALLERY.length).toBeGreaterThanOrEqual(8);
    expect(new Set(GALLERY.map((sample) => sample.id)).size).toBe(GALLERY.length);
  });

  test.each(GALLERY.map((sample) => [sample.id, sample] as const))(
    "%s is a valid recipe that parsing leaves unchanged",
    (_, { recipe }) => {
      expect(parseRecipe(structuredClone(recipe))).toEqual(recipe);
    },
  );

  test("shows every figure and only text the bundled fonts cover", () => {
    const figures = new Set<string>();
    for (const { recipe } of GALLERY) {
      for (const layer of recipe.layers) {
        if (layer.kind === "sample" && layer.shape.type === "figure") {
          figures.add(layer.shape.figure);
        }
        expect(layer.kind === "text" ? uncoveredCharacters(layer.text) : []).toEqual([]);
      }
    }
    expect([...figures].toSorted()).toEqual(FIGURE_IDS.toSorted());
  });

  test("uses palettes with enough contrast to see", () => {
    for (const { recipe } of GALLERY) {
      expect(luminanceSpread(recipe.texture.palette)).toBeGreaterThanOrEqual(MIN_LUMINANCE_SPREAD);
    }
  });
});
