import { effect } from "@preact/signals";
import { describe, expect, test } from "vitest";
import { defaultRecipe, type Asset, type ImageLayer } from "../core/recipe.ts";
import { Editor } from "./editor.ts";

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

  test("texture and layer actions replace their part of the recipe", () => {
    const editor = new Editor();
    editor.setTexture({ scale: 2 });
    editor.updateLayers(() => []);
    expect(editor.recipe.value.texture.scale).toBe(2);
    expect(editor.recipe.value.layers).toEqual([]);
    editor.undo();
    expect(editor.recipe.value.layers).toHaveLength(1);
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
    const layer: ImageLayer = {
      kind: "image",
      id: "image-1",
      name: "Image",
      visible: true,
      blend: "max",
      depth: 1,
      asset: "photo",
      fit: "contain",
      invert: false,
      levels: { black: 0, white: 1 },
      blur: 0,
      posterize: null,
      threshold: null,
    };
    const editor = new Editor();
    editor.updateLayers((layers) => [...layers, layer], { assets: { photo: pixel } });
    expect(editor.recipe.value.assets).toEqual({ photo: pixel });
    editor.updateLayers((layers) => layers.slice(0, 1));
    expect(editor.recipe.value.assets).toEqual({});
    editor.undo();
    expect(editor.recipe.value.assets.photo).toBe(pixel);
  });
});
