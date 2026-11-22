import { describe, expect, test } from "vitest";
import {
  canAddAsset,
  freeAssetId,
  missingAssets,
  pruneAssets,
  referencedAssets,
} from "./assets.ts";
import { RECIPE_LIMITS } from "./parseRecipe.ts";
import { defaultRecipe, type Asset, type ImageLayer, type Recipe } from "./recipe.ts";

function image(id: string, asset: string): ImageLayer {
  return {
    kind: "image",
    id,
    name: id,
    visible: true,
    blend: "max",
    depth: 1,
    asset,
    fit: "contain",
    invert: false,
    levels: { black: 0, white: 1 },
    blur: 0,
    posterize: null,
    threshold: null,
  };
}

const pixel: Asset = { format: "gray", width: 1, height: 1, data: new Uint8Array([7]) };

function recipe(layers: ImageLayer[], assets: Record<string, Asset>): Recipe {
  const base = defaultRecipe();
  return { ...base, layers: [...base.layers, ...layers], assets };
}

describe("referencedAssets", () => {
  test("lists each asset image layers use once, in stack order", () => {
    const value = recipe([image("a", "two"), image("b", "one"), image("c", "two")], {});
    expect(referencedAssets(value)).toEqual(["two", "one"]);
  });
});

describe("missingAssets", () => {
  test("lists referenced assets the recipe doesn't hold", () => {
    const value = recipe([image("a", "held"), image("b", "gone"), image("c", "constructor")], {
      held: pixel,
    });
    expect(missingAssets(value)).toEqual(["gone", "constructor"]);
  });
});

describe("pruneAssets", () => {
  test("drops assets nothing references", () => {
    const value = recipe([image("a", "kept")], { kept: pixel, stale: pixel });
    const pruned = pruneAssets(value);
    expect(Object.keys(pruned.assets)).toEqual(["kept"]);
    expect(pruned.assets.kept).toBe(pixel);
  });

  test("returns the same recipe when every asset is used", () => {
    const value = recipe([image("a", "kept")], { kept: pixel });
    expect(pruneAssets(value)).toBe(value);
  });
});

describe("freeAssetId", () => {
  test("avoids held and referenced IDs", () => {
    const value = recipe([image("a", "image-2")], { "image-1": pixel });
    expect(freeAssetId(value, "image")).toBe("image-3");
  });
});

test("canAddAsset stops at the recipe's asset limit", () => {
  const assets = Object.fromEntries(
    Array.from({ length: RECIPE_LIMITS.assets }, (_, i) => [`a${String(i)}`, pixel]),
  );
  expect(canAddAsset({ assets })).toBe(false);
  expect(canAddAsset({ assets: {} })).toBe(true);
});
