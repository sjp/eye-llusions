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

/** Whether the recipe can hold one more asset. */
export function canAddAsset(recipe: Pick<Recipe, "assets">): boolean {
  return Object.keys(recipe.assets).length < RECIPE_LIMITS.assets;
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
