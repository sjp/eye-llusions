import { defaultRecipe, type Recipe } from "../core/recipe.ts";

/** What to look for in the practice image, as the viewer describes it. */
export const PRACTICE_TARGET = "the word HI standing out in front of the pattern";

/**
 * An easy image to learn on: one bold, flat-topped word with sharp edges, standing well
 * out from the background, in a coarse, high-contrast pattern. `repeats` sizes its strips
 * for the screen it is shown on.
 */
export function practiceRecipe(mode: Recipe["view"]["mode"], repeats: number): Recipe {
  const base = defaultRecipe();
  return {
    ...base,
    seed: 0x9a_c71c,
    layers: [
      {
        kind: "text",
        id: "hi",
        name: "HI",
        visible: true,
        blend: "max",
        depth: 1,
        text: "HI",
        font: "anton",
        size: 0.7,
        center: { x: 0.5, y: 0.5 },
        edge: "flat",
        edgeWidth: 0.02,
      },
    ],
    texture: {
      generator: { type: "colourNoise" },
      palette: { type: "preset", id: "neon" },
      scale: 2,
      seed: 0,
    },
    view: { repeats, depthOfField: 0.4, mode },
    assets: {},
  };
}
