import { describe, expect, test } from "vitest";
import {
  canReplaceAsset,
  canReplaceTile,
  freeAssetId,
  newAssetId,
  missingAssets,
  newTileId,
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

function withTile(value: Recipe, asset: string): Recipe {
  return {
    ...value,
    texture: { ...value.texture, generator: { type: "tile", asset, divisions: 1, jitter: 0 } },
  };
}

describe("referencedAssets", () => {
  test("lists each asset image layers use once, in stack order", () => {
    const value = recipe([image("a", "two"), image("b", "one"), image("c", "two")], {});
    expect(referencedAssets(value)).toEqual(["two", "one"]);
  });

  test("includes a tile texture's image after the layers'", () => {
    const value = withTile(recipe([image("a", "two"), image("b", "tile-1")], {}), "tile-1");
    expect(referencedAssets(value)).toEqual(["two", "tile-1"]);
    expect(referencedAssets(withTile(recipe([], {}), "tile-2"))).toEqual(["tile-2"]);
  });
});

describe("missingAssets", () => {
  test("lists referenced assets the recipe doesn't hold", () => {
    const value = recipe([image("a", "held"), image("b", "gone"), image("c", "constructor")], {
      held: pixel,
    });
    expect(missingAssets(value)).toEqual(["gone", "constructor"]);
  });

  test("lists a missing tile", () => {
    expect(missingAssets(withTile(recipe([], {}), "tile-1"))).toEqual(["tile-1"]);
    expect(missingAssets(withTile(recipe([], { "tile-1": pixel }), "tile-1"))).toEqual([]);
  });
});

describe("pruneAssets", () => {
  test("drops assets nothing references", () => {
    const value = recipe([image("a", "kept")], { kept: pixel, stale: pixel });
    const pruned = pruneAssets(value);
    expect(Object.keys(pruned.assets)).toEqual(["kept"]);
    expect(pruned.assets.kept).toBe(pixel);
  });

  test("keeps a tile texture's image", () => {
    const value = withTile(
      recipe([image("a", "kept")], { kept: pixel, "tile-1": pixel }),
      "tile-1",
    );
    expect(pruneAssets(value)).toBe(value);
    const switched = { ...value, texture: defaultRecipe().texture };
    expect(Object.keys(pruneAssets(switched).assets)).toEqual(["kept"]);
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
    expect(freeAssetId(withTile(value, "tile-1"), "tile")).toBe("tile-2");
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
    expect(canReplaceAsset(withTile(recipe([image("a", "a0")], full), "a0"), "a")).toBe(false);
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

describe("canReplaceTile", () => {
  const full = Object.fromEntries(
    Array.from({ length: RECIPE_LIMITS.assets }, (_, i) => [`a${String(i)}`, pixel]),
  );

  test("allows a new tile while there is room", () => {
    expect(canReplaceTile(recipe([], {}))).toBe(true);
    expect(canReplaceTile(withTile(recipe([], {}), "tile-1"))).toBe(true);
  });

  test("refuses a new tile when full, unless it replaces one only the texture uses", () => {
    expect(canReplaceTile(recipe([], full))).toBe(false);
    expect(canReplaceTile(withTile(recipe([], full), "gone"))).toBe(false);
    expect(canReplaceTile(withTile(recipe([], full), "a0"))).toBe(true);
    expect(canReplaceTile(withTile(recipe([image("a", "a0")], full), "a0"))).toBe(false);
  });
});

describe("newTileId", () => {
  test("reuses a missing tile ID that only the texture uses", () => {
    expect(newTileId(withTile(recipe([], {}), "tile-4"))).toBe("tile-4");
  });

  test("picks a free ID when the tile is held, shared or not in use", () => {
    expect(newTileId(withTile(recipe([], { "tile-1": pixel }), "tile-1"))).toBe("tile-2");
    expect(newTileId(withTile(recipe([image("a", "tile-1")], {}), "tile-1"))).toBe("tile-2");
    expect(newTileId(recipe([], {}))).toBe("tile-1");
  });
});
