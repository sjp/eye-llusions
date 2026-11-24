import { describe, expect, test } from "vitest";
import { canReplaceAsset, canReplaceTile, newAssetId, newTileId } from "../../core/assets.ts";
import { strokeCost } from "../../core/depth/drawing.ts";
import { parseRecipe, RECIPE_LIMITS } from "../../core/parseRecipe.ts";
import { createRandom, type Random } from "../../core/random.ts";
import { defaultRecipe, type Asset, type Recipe } from "../../core/recipe.ts";
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
  strokeFits,
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
    const { layers, aspect } = editor.recipe.value;
    const layer = pick(random, layers);
    if (layer !== undefined && canDuplicateLayer(layers, layer.id, aspect)) {
      editor.updateLayers((current) => duplicateLayer(current, layer.id, aspect));
    }
  },
  (editor, random) => {
    const { layers, aspect } = editor.recipe.value;
    const drawing = pick(
      random,
      layers.filter((layer) => layer.kind === "drawing"),
    );
    const room = drawing === undefined ? 0 : strokeRoom(layers, drawing.id);
    // Mostly fine strokes in small steps, which run into the point limits, and now and
    // then a broad sweep, which runs into the drawing area limit.
    const broad = random.float() < 0.5;
    const step = (value: number) =>
      Math.min(1.5, Math.max(-0.5, value + (random.float() - 0.5) * (broad ? 1 : 0.002)));
    let x = random.float();
    let y = random.float();
    const points = Array.from({ length: broad ? Math.min(room, 24) : room }, () => {
      x = step(x);
      y = step(y);
      return [x, y];
    }).flat();
    const brush = { size: broad ? 0.75 : 0.002, softness: 0, mode: "set", value: 1 } as const;
    const stroke = { brush, points };
    if (drawing !== undefined && room > 0 && strokeFits(layers, drawing.id, stroke, aspect)) {
      editor.updateLayers((current) => addStroke(current, drawing.id, stroke));
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

function drawingTotals(recipe: Recipe): { points: number; area: number } {
  const totals = { points: 0, area: 0 };
  for (const layer of recipe.layers) {
    if (layer.kind === "drawing") {
      for (const stroke of layer.strokes) {
        totals.points += stroke.points.length / 2;
        totals.area += strokeCost(stroke, recipe.aspect);
      }
    }
  }
  return totals;
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
    // Many actions change nothing, and a scene already checked needn't be checked again.
    const checked = new WeakSet<Recipe>();
    const reached = { layers: false, points: false, area: false, assets: false };
    for (let step = 0; step < 300; step++) {
      pick(random, ACTIONS)?.(editor, random);
      editor.endEdit();
      const recipe: Recipe = editor.recipe.value;
      if (checked.has(recipe)) {
        continue;
      }
      checked.add(recipe);
      expect(() => parseRecipe(recipe), `after step ${String(step)}`).not.toThrow();
      reached.layers ||= recipe.layers.length === RECIPE_LIMITS.layers;
      const totals = drawingTotals(recipe);
      reached.points ||= totals.points > RECIPE_LIMITS.pointsTotal / 2;
      reached.area ||= totals.area > RECIPE_LIMITS.drawingArea / 2;
      reached.assets ||= Object.keys(recipe.assets).length === RECIPE_LIMITS.assets;
    }
    expect(reached).toEqual({ layers: true, points: true, area: true, assets: true });
  });
});
