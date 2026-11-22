import { describe, expect, test } from "vitest";
import {
  canReplaceAsset,
  freeAssetId,
  newAssetId,
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

describe("canReplaceAsset", () => {
  const full = Object.fromEntries(
    Array.from({ length: RECIPE_LIMITS.assets }, (_, i) => [`a${String(i)}`, pixel]),
  );

  test("allows a new asset while there is room", () => {
    expect(canReplaceAsset(recipe([image("a", "gone")], {}), "a")).toBe(true);
  });

  test("refuses a layer with a missing asset when the recipe is full", () => {
    expect(canReplaceAsset(recipe([image("a", "gone")], full), "a")).toBe(false);
  });

  test("allows replacing an asset only this layer uses, even when full", () => {
    expect(canReplaceAsset(recipe([image("a", "a0")], full), "a")).toBe(true);
    expect(canReplaceAsset(recipe([image("a", "a0"), image("b", "a0")], full), "a")).toBe(false);
  });

  test("refuses layers that aren't images", () => {
    expect(canReplaceAsset(defaultRecipe(), "sphere")).toBe(false);
  });
});

describe("newAssetId", () => {
  test("reuses a missing ID that only this layer uses", () => {
    expect(newAssetId(recipe([image("a", "photo")], {}), "a")).toBe("photo");
  });

  test("picks a free ID when the asset is held or shared", () => {
    expect(newAssetId(recipe([image("a", "photo")], { photo: pixel }), "a")).toBe("image-1");
    expect(newAssetId(recipe([image("a", "photo"), image("b", "photo")], {}), "a")).toBe("image-1");
  });
});
