import { describe, expect, test } from "vitest";
import { canReplaceAsset, canReplaceTile, newAssetId, newTileId } from "../../core/assets.ts";
import { parseRecipe, RECIPE_LIMITS } from "../../core/parseRecipe.ts";
import { createRandom, type Random } from "../../core/random.ts";
import { defaultRecipe, type Asset, type Layer, type Recipe } from "../../core/recipe.ts";
import { Editor } from "../../state/editor.ts";
import {
  addStroke,
  canAddLayer,
  canDuplicateLayer,
  changeLayer,
  duplicateLayer,
  freeLayerName,
  insertLayer,
  moveLayer,
  removeLayer,
  strokeRoom,
  withFreeIdentity,
} from "../../state/layers.ts";
import { LAYER_KINDS } from "./kinds.ts";

const KINDS = Object.values(LAYER_KINDS);

const ASSET: Asset = { format: "gray", width: 2, height: 2, data: new Uint8Array(4) };
const TILE: Asset = { format: "rgba", width: 2, height: 2, data: new Uint8Array(16) };

function pick<T>(random: Random, items: readonly T[]): T | undefined {
  return items[Math.floor(random.float() * items.length)];
}

/**
 * One editor action, guarded by the same checks the editor's controls use. Each one
 * pushes towards a limit, so a long run spends most of its time at the limits.
 */
const ACTIONS: ((editor: Editor, random: Random) => void)[] = [
  (editor, random) => {
    const { layers } = editor.recipe.value;
    const kind = pick(random, KINDS);
    if (kind !== undefined && canAddLayer(layers)) {
      const layer = withFreeIdentity(layers, kind.create(editor.recipe.value));
      editor.updateLayers((current) => insertLayer(current, layer, pick(random, current)?.id));
    }
  },
  (editor, random) => {
    const { layers } = editor.recipe.value;
    const layer = pick(random, layers);
    if (layer !== undefined && canDuplicateLayer(layers, layer.id)) {
      editor.updateLayers((current) => duplicateLayer(current, layer.id));
    }
  },
  (editor, random) => {
    const { layers } = editor.recipe.value;
    const drawing = pick(
      random,
      layers.filter((layer) => layer.kind === "drawing"),
    );
    const room = drawing === undefined ? 0 : strokeRoom(layers, drawing.id);
    if (drawing !== undefined && room > 0) {
      const points = Array.from({ length: room * 2 }, () => random.float());
      const brush = { size: 0.05, softness: 0, mode: "set", value: 1 } as const;
      editor.updateLayers((current) => addStroke(current, drawing.id, { brush, points }));
    }
  },
  (editor, random) => {
    const layer = pick(random, editor.recipe.value.layers);
    if (layer !== undefined) {
      const name = "n".repeat(RECIPE_LIMITS.nameLength);
      editor.updateLayers((current) =>
        changeLayer(current, layer.id, (each) => ({ ...each, name: freeLayerName(current, name) })),
      );
    }
  },
  (editor, random) => {
    const text = pick(
      random,
      editor.recipe.value.layers.filter((layer) => layer.kind === "text"),
    );
    if (text !== undefined) {
      editor.updateLayers((current) =>
        changeLayer(current, text.id, (each) => ({
          ...each,
          text: "W".repeat(RECIPE_LIMITS.textLength),
        })),
      );
    }
  },
  (editor) => {
    for (const image of editor.recipe.value.layers) {
      const recipe = editor.recipe.value;
      if (image.kind === "image" && canReplaceAsset(recipe, image.id)) {
        const id = newAssetId(recipe, image.id);
        editor.updateLayers(
          (current) => changeLayer(current, image.id, (each) => ({ ...each, asset: id })),
          { assets: { [id]: ASSET } },
        );
      }
    }
  },
  (editor) => {
    const recipe = editor.recipe.value;
    if (canReplaceTile(recipe)) {
      const id = newTileId(recipe);
      editor.setTexture(
        { generator: { type: "tile", asset: id, divisions: 1, jitter: 0 } },
        { assets: { [id]: TILE } },
      );
    }
  },
  (editor, random) => {
    const layer = pick(random, editor.recipe.value.layers);
    if (layer !== undefined) {
      editor.updateLayers((current) =>
        moveLayer(current, layer.id, Math.floor(random.float() * current.length)),
      );
    }
  },
  (editor, random) => {
    const layer = pick(random, editor.recipe.value.layers);
    if (layer !== undefined && random.float() < 0.3) {
      editor.updateLayers((current) => removeLayer(current, layer.id));
    }
  },
  (editor, random) => {
    if (random.float() < 0.3) {
      editor.undo();
    }
  },
];

function totalPoints(layers: readonly Layer[]): number {
  let total = 0;
  for (const layer of layers) {
    if (layer.kind === "drawing") {
      for (const stroke of layer.strokes) {
        total += stroke.points.length / 2;
      }
    }
  }
  return total;
}

/** A scene with one image layer fewer than the asset limit, each with its own image. */
function imagesShortOfTheLimit(): Recipe {
  const recipe = defaultRecipe();
  const image = LAYER_KINDS.image?.create(recipe);
  if (image === undefined) {
    throw new Error("no image layers");
  }
  for (let i = 1; i < RECIPE_LIMITS.assets; i++) {
    const asset = `image-${String(i)}`;
    recipe.layers.push({ ...image, id: asset, name: asset, asset });
    recipe.assets[asset] = ASSET;
  }
  return recipe;
}

describe("editor actions at the recipe's limits", () => {
  test.each([1, 2, 3])("keep every scene parseable (seed %i)", (seed) => {
    const random = createRandom(seed);
    const editor = new Editor(imagesShortOfTheLimit());
    const reached = { layers: false, points: false, assets: false };
    for (let step = 0; step < 300; step++) {
      pick(random, ACTIONS)?.(editor, random);
      editor.endEdit();
      const recipe: Recipe = editor.recipe.value;
      expect(() => parseRecipe(recipe), `after step ${String(step)}`).not.toThrow();
      reached.layers ||= recipe.layers.length === RECIPE_LIMITS.layers;
      reached.points ||= totalPoints(recipe.layers) > RECIPE_LIMITS.pointsTotal / 2;
      reached.assets ||= Object.keys(recipe.assets).length === RECIPE_LIMITS.assets;
    }
    expect(reached).toEqual({ layers: true, points: true, assets: true });
  });
});
