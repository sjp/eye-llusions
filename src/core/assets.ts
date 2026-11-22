import { RECIPE_LIMITS } from "./parseRecipe.ts";
import type { Recipe } from "./recipe.ts";

type References = Pick<Recipe, "layers" | "texture">;

/** The asset IDs that image layers (in stack order) and then a tile texture use, without repeats. */
export function referencedAssets(recipe: References): string[] {
  const ids = new Set<string>();
  for (const layer of recipe.layers) {
    if (layer.kind === "image") {
      ids.add(layer.asset);
    }
  }
  if (recipe.texture.generator.type === "tile") {
    ids.add(recipe.texture.generator.asset);
  }
  return [...ids];
}

/** How many layers and textures refer to asset `id`. */
function users(recipe: References, id: string): number {
  let count =
    recipe.texture.generator.type === "tile" && recipe.texture.generator.asset === id ? 1 : 0;
  for (const layer of recipe.layers) {
    if (layer.kind === "image" && layer.asset === id) {
      count += 1;
    }
  }
  return count;
}

/**
 * Asset IDs that the recipe uses but doesn't hold, such as after opening a share link,
 * which carries no assets. Those layers render as nothing, and a tile as random dots,
 * until filled.
 */
export function missingAssets(recipe: References & Pick<Recipe, "assets">): string[] {
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

type AssetRecipe = Pick<Recipe, "layers" | "texture" | "assets">;

/** Whether the asset `id` can be swapped for a new one within the recipe's asset limit. */
function canReplace(recipe: AssetRecipe, id: string): boolean {
  const freed = Object.hasOwn(recipe.assets, id) && users(recipe, id) === 1 ? 1 : 0;
  return Object.keys(recipe.assets).length - freed < RECIPE_LIMITS.assets;
}

/** The current ID when it is missing and has no other user, otherwise a free one. */
function replacementId(recipe: AssetRecipe, id: string, prefix: string): string {
  return !Object.hasOwn(recipe.assets, id) && users(recipe, id) === 1
    ? id
    : freeAssetId(recipe, prefix);
}

/** Whether image layer `layerId` can take a new asset without the recipe exceeding its limit. */
export function canReplaceAsset(recipe: AssetRecipe, layerId: string): boolean {
  const layer = recipe.layers.find((each) => each.id === layerId);
  return layer?.kind === "image" && canReplace(recipe, layer.asset);
}

/**
 * The ID for a new asset on image layer `layerId`: its current ID when that is missing
 * and nothing else uses it, otherwise a free one, so other users keep their images.
 */
export function newAssetId(recipe: AssetRecipe, layerId: string): string {
  const layer = recipe.layers.find((each) => each.id === layerId);
  return layer?.kind === "image"
    ? replacementId(recipe, layer.asset, "image")
    : freeAssetId(recipe, "image");
}

/** Whether the tile texture can take a new image without the recipe exceeding its limit. */
export function canReplaceTile(recipe: AssetRecipe): boolean {
  const { generator } = recipe.texture;
  return generator.type === "tile"
    ? canReplace(recipe, generator.asset)
    : Object.keys(recipe.assets).length < RECIPE_LIMITS.assets;
}

/** The ID for a new tile image, chosen as `newAssetId` does for layers. */
export function newTileId(recipe: AssetRecipe): string {
  const { generator } = recipe.texture;
  return generator.type === "tile"
    ? replacementId(recipe, generator.asset, "tile")
    : freeAssetId(recipe, "tile");
}

/** `${prefix}-N` with the smallest N ≥ 1 that is neither held nor referenced. */
export function freeAssetId(recipe: AssetRecipe, prefix: string): string {
  const taken = new Set([...Object.keys(recipe.assets), ...referencedAssets(recipe)]);
  for (let n = 1; ; n++) {
    const id = `${prefix}-${String(n)}`;
    if (!taken.has(id)) {
      return id;
    }
  }
}
