import { describe, expect, test } from "vitest";
import { parseRecipe } from "../core/parseRecipe.ts";
import { practiceRecipe } from "./practice.ts";

describe("practiceRecipe", () => {
  test("is a valid recipe in the asked-for mode and strip count", () => {
    for (const mode of ["wall", "cross"] as const) {
      const recipe = practiceRecipe(mode, 12);
      expect(parseRecipe(structuredClone(recipe))).toEqual(recipe);
      expect(recipe.view).toMatchObject({ mode, repeats: 12 });
    }
  });
});
