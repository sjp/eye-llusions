import { expect, test } from "vitest";
import { defaultRecipe } from "../../core/recipe.ts";
import { paletteSwatch, textureSwatch } from "./swatches.ts";

test("a texture swatch shows the texture in opaque palette colours", () => {
  const recipe = defaultRecipe();
  const image = textureSwatch(recipe.texture, recipe, 32, 16);
  expect([image.width, image.height]).toEqual([32, 16]);
  const colours = new Set<string>();
  for (let i = 0; i < image.data.length; i += 4) {
    expect(image.data[i + 3]).toBe(255);
    colours.add(Array.from(image.data.subarray(i, i + 3)).join(","));
  }
  expect(colours).toEqual(new Set(["0,0,0", "255,255,255"]));
});

test("a texture swatch shows coarser features at a larger scale", () => {
  const recipe = defaultRecipe();
  const changes = (scale: number) => {
    const { data } = textureSwatch({ ...recipe.texture, scale }, recipe, 64, 1);
    let count = 0;
    for (let x = 1; x < 64; x++) {
      count += data[x * 4] === data[x * 4 - 4] ? 0 : 1;
    }
    return count;
  };
  expect(changes(4)).toBeLessThan(changes(1));
});

test("a palette swatch runs from the first stop to the last", () => {
  const image = paletteSwatch({ type: "custom", stops: ["#102030", "#f0e0d0"] }, 16, 2);
  expect(Array.from(image.data.subarray(0, 4))).toEqual([0x10, 0x20, 0x30, 255]);
  const last = (16 * 2 - 1) * 4;
  expect(Array.from(image.data.subarray(last, last + 3))).toEqual([0xf0, 0xe0, 0xd0]);
});
