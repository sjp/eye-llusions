import { effect } from "@preact/signals";
import { describe, expect, test } from "vitest";
import { defaultRecipe, type Asset, type ImageLayer } from "../core/recipe.ts";
import { scaleLimits } from "../core/texture/scale.ts";
import { Editor } from "./editor.ts";

function imageLayer(asset: string): ImageLayer {
  return {
    kind: "image",
    id: "image-1",
    name: "Image",
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

describe("Editor", () => {
  test("starts from the default recipe with nothing to undo", () => {
    const editor = new Editor();
    expect(editor.recipe.value).toEqual(defaultRecipe());
    expect(editor.canUndo.value).toBe(false);
    expect(editor.canRedo.value).toBe(false);
  });

  test("view changes are undoable and redoable", () => {
    const editor = new Editor();
    editor.setView({ repeats: 10 });
    editor.setView({ mode: "cross" });
    expect(editor.recipe.value.view).toMatchObject({ repeats: 10, mode: "cross" });
    editor.undo();
    expect(editor.recipe.value.view).toMatchObject({ repeats: 10, mode: "wall" });
    expect(editor.canRedo.value).toBe(true);
    editor.undo();
    expect(editor.recipe.value).toEqual(defaultRecipe());
    expect(editor.canUndo.value).toBe(false);
    editor.redo();
    editor.redo();
    expect(editor.recipe.value.view).toMatchObject({ repeats: 10, mode: "cross" });
  });

  test("a coalesced drag undoes as one step", () => {
    const editor = new Editor();
    for (const repeats of [9, 10, 11, 12]) {
      editor.setView({ repeats }, { coalesce: "repeats" });
    }
    expect(editor.editing.value).toBe(true);
    editor.endEdit();
    expect(editor.editing.value).toBe(false);
    editor.undo();
    expect(editor.recipe.value.view.repeats).toBe(8);
    expect(editor.canUndo.value).toBe(false);
  });

  test("new seed uses the seed source", () => {
    const editor = new Editor(defaultRecipe(), () => 42);
    editor.newSeed();
    expect(editor.recipe.value.seed).toBe(42);
    editor.undo();
    expect(editor.recipe.value.seed).toBe(defaultRecipe().seed);
  });

  test("new texture seed changes only the texture's seed", () => {
    const editor = new Editor(defaultRecipe(), () => 7);
    editor.newTextureSeed();
    expect(editor.recipe.value.texture.seed).toBe(7);
    expect(editor.recipe.value.seed).toBe(defaultRecipe().seed);
    editor.undo();
    expect(editor.recipe.value.texture.seed).toBe(0);
  });

  test("texture and layer actions replace their part of the recipe", () => {
    const editor = new Editor();
    editor.setTexture({ scale: 2 });
    editor.updateLayers(() => []);
    expect(editor.recipe.value.texture.scale).toBe(2);
    expect(editor.recipe.value.layers).toEqual([]);
    editor.undo();
    expect(editor.recipe.value.layers).toHaveLength(1);
  });

  test("keeps the texture scale within the fusible range", () => {
    const editor = new Editor();
    const { aspect } = defaultRecipe();
    editor.setTexture({ scale: 100 });
    expect(editor.recipe.value.texture.scale).toBe(scaleLimits("randomDots", aspect, 8).max);
    editor.setTexture({ generator: { type: "cells", shading: 0 } });
    expect(editor.recipe.value.texture.scale).toBe(scaleLimits("cells", aspect, 8).max);
    editor.setView({ repeats: 32 });
    expect(editor.recipe.value.texture.scale).toBe(scaleLimits("cells", aspect, 32).max);
  });

  test("a layer update that returns the same stack adds no undo step", () => {
    const editor = new Editor();
    editor.updateLayers((layers) => layers);
    expect(editor.canUndo.value).toBe(false);
  });

  test("notifies subscribers once per change", () => {
    const editor = new Editor();
    const seen: number[] = [];
    const stop = effect(() => {
      seen.push(editor.recipe.value.view.repeats);
    });
    editor.setView({ repeats: 12 });
    editor.undo();
    stop();
    expect(seen).toEqual([8, 12, 8]);
  });

  test("layer updates add assets and drop ones no layer uses", () => {
    const pixel: Asset = { format: "gray", width: 1, height: 1, data: new Uint8Array([9]) };
    const layer = imageLayer("photo");
    const editor = new Editor();
    editor.updateLayers((layers) => [...layers, layer], { assets: { photo: pixel } });
    expect(editor.recipe.value.assets).toEqual({ photo: pixel });
    editor.updateLayers((layers) => layers.slice(0, 1));
    expect(editor.recipe.value.assets).toEqual({});
    editor.undo();
    expect(editor.recipe.value.assets.photo).toBe(pixel);
  });

  test("keeps a tile texture's image through layer edits, undo and redo", () => {
    const tile: Asset = { format: "rgba", width: 1, height: 1, data: new Uint8Array(4) };
    const photo: Asset = { format: "gray", width: 1, height: 1, data: new Uint8Array([9]) };
    const editor = new Editor();
    const generator = { type: "tile", asset: "tile-1", divisions: 1, jitter: 0 } as const;
    editor.setTexture({ generator }, { assets: { "tile-1": tile } });
    expect(editor.recipe.value.assets).toEqual({ "tile-1": tile });

    // Adding and removing image layers drops only their own assets.
    editor.updateLayers((layers) => [...layers, imageLayer("photo")], { assets: { photo } });
    editor.updateLayers((layers) => layers.slice(0, 1));
    expect(editor.recipe.value.assets).toEqual({ "tile-1": tile });
    editor.updateLayers((layers) => layers.map((layer) => ({ ...layer, depth: 0.5 })));
    editor.setTexture({ generator: { ...generator, jitter: 0.5 } });
    editor.setView({ repeats: 10 });
    expect(editor.recipe.value.assets["tile-1"]).toBe(tile);

    for (let step = 0; step < 5; step++) {
      editor.undo();
      expect(editor.recipe.value.assets["tile-1"]).toBe(tile);
    }
    editor.undo();
    expect(editor.recipe.value.assets).toEqual({});
    while (editor.canRedo.value) {
      editor.redo();
      expect(editor.recipe.value.assets["tile-1"]).toBe(tile);
    }
    expect(editor.recipe.value.texture.generator).toEqual({ ...generator, jitter: 0.5 });

    // A new tile replaces the old one, and switching pattern drops it.
    const next: Asset = { ...tile, data: new Uint8Array(4).fill(1) };
    editor.setTexture(
      { generator: { ...generator, asset: "tile-2" } },
      { assets: { "tile-2": next } },
    );
    expect(editor.recipe.value.assets).toEqual({ "tile-2": next });
    editor.setTexture({ generator: { type: "colourNoise" } });
    expect(editor.recipe.value.assets).toEqual({});
    editor.undo();
    expect(editor.recipe.value.assets["tile-2"]).toBe(next);
  });

  test("opening a recipe is one undo step, or starts history over when fresh", () => {
    const editor = new Editor();
    editor.setView({ repeats: 10 }, { coalesce: "repeats" });
    const shared = { ...defaultRecipe(), seed: 42 };
    editor.open(shared);
    expect(editor.recipe.value).toBe(shared);
    expect(editor.editing.value).toBe(false);
    editor.undo();
    expect(editor.recipe.value.view.repeats).toBe(10);
    editor.redo();
    expect(editor.recipe.value).toBe(shared);

    const other = { ...defaultRecipe(), seed: 7 };
    editor.open(other, { fresh: true });
    expect(editor.recipe.value).toBe(other);
    expect(editor.canUndo.value).toBe(false);
    expect(editor.canRedo.value).toBe(false);
  });

  test("tracks changes since the recipe was last opened, shared or saved", () => {
    const editor = new Editor();
    expect(editor.modified.value).toBe(false);
    editor.setView({ repeats: 10 });
    expect(editor.modified.value).toBe(true);
    editor.undo();
    expect(editor.modified.value).toBe(false);
    editor.redo();
    editor.markSaved({ withAssets: true });
    expect(editor.modified.value).toBe(false);
    editor.undo();
    expect(editor.modified.value).toBe(true);

    editor.open({ ...defaultRecipe(), seed: 42 });
    expect(editor.modified.value).toBe(false);
    editor.undo();
    expect(editor.modified.value).toBe(true);
  });

  test("a scene with images shared without them still counts as modified", () => {
    const editor = new Editor();
    editor.markSaved({ withAssets: false });
    expect(editor.modified.value).toBe(false);

    const pixel: Asset = { format: "gray", width: 1, height: 1, data: new Uint8Array(1) };
    editor.updateLayers(() => [imageLayer("image-1")], { assets: { "image-1": pixel } });
    editor.markSaved({ withAssets: false });
    expect(editor.modified.value).toBe(true);
    expect(editor.imagesUnsaved.value).toBe(true);

    editor.markSaved({ withAssets: true });
    expect(editor.modified.value).toBe(false);
    expect(editor.imagesUnsaved.value).toBe(false);
    editor.markSaved({ withAssets: false });
    expect(editor.modified.value).toBe(false);

    editor.setView({ repeats: 10 });
    expect(editor.modified.value).toBe(true);
    expect(editor.imagesUnsaved.value).toBe(false);
    editor.markSaved({ withAssets: false });
    expect(editor.imagesUnsaved.value).toBe(true);
    editor.updateLayers(() => []);
    expect(editor.imagesUnsaved.value).toBe(false);
    expect(editor.modified.value).toBe(true);
  });
});
