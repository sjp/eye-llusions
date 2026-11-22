import { RECIPE_LIMITS } from "./parseRecipe.ts";
import type { Recipe } from "./recipe.ts";

/** IDs of the assets the recipe's layers use, in stack order without repeats. */
export function referencedAssets(recipe: Pick<Recipe, "layers">): string[] {
  const ids = new Set<string>();
  for (const layer of recipe.layers) {
    if (layer.kind === "image") {
      ids.add(layer.asset);
    }
  }
  return [...ids];
}

/**
 * Asset IDs that layers use but the recipe doesn't hold, such as after opening a share
 * link, which carries no assets. Those layers render as nothing until filled.
 */
export function missingAssets(recipe: Pick<Recipe, "layers" | "assets">): string[] {
  return referencedAssets(recipe).filter((id) => !Object.hasOwn(recipe.assets, id));
}

/** The recipe without assets that nothing references; the same recipe if there are none. */
export function pruneAssets(recipe: Recipe): Recipe {
  const used = new Set(referencedAssets(recipe));
  const ids = Object.keys(recipe.assets);
  if (ids.every((id) => used.has(id))) {
    return recipe;
  }
  return {
    ...recipe,
    assets: Object.fromEntries(
      ids.filter((id) => used.has(id)).map((id) => [id, recipe.assets[id]]),
    ),
  };
}

/** Whether image layer `layerId` can take a new asset without the recipe exceeding its limit. */
export function canReplaceAsset(
  recipe: Pick<Recipe, "layers" | "assets">,
  layerId: string,
): boolean {
  const layer = recipe.layers.find((each) => each.id === layerId);
  if (layer?.kind !== "image") {
    return false;
  }
  const shared = recipe.layers.some(
    (each) => each !== layer && each.kind === "image" && each.asset === layer.asset,
  );
  const freed = Object.hasOwn(recipe.assets, layer.asset) && !shared ? 1 : 0;
  return Object.keys(recipe.assets).length - freed < RECIPE_LIMITS.assets;
}

/**
 * The ID for a new asset on image layer `layerId`: its current ID when that is missing
 * and no other layer uses it, otherwise a free one, so other layers keep their images.
 */
export function newAssetId(recipe: Pick<Recipe, "layers" | "assets">, layerId: string): string {
  const layer = recipe.layers.find((each) => each.id === layerId);
  if (
    layer?.kind === "image" &&
    !Object.hasOwn(recipe.assets, layer.asset) &&
    !recipe.layers.some(
      (each) => each !== layer && each.kind === "image" && each.asset === layer.asset,
    )
  ) {
    return layer.asset;
  }
  return freeAssetId(recipe, "image");
}

/** `${prefix}-N` with the smallest N ≥ 1 that is neither held nor referenced. */
export function freeAssetId(recipe: Pick<Recipe, "layers" | "assets">, prefix: string): string {
  const taken = new Set([...Object.keys(recipe.assets), ...referencedAssets(recipe)]);
  for (let n = 1; ; n++) {
    const id = `${prefix}-${String(n)}`;
    if (!taken.has(id)) {
      return id;
    }
  }
}
