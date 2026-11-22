import { describe, expect, test } from "vitest";
import { RECIPE_LIMITS } from "../core/parseRecipe.ts";
import { defaultRecipe, type Layer } from "../core/recipe.ts";
import {
  canAddLayer,
  changeLayer,
  duplicateLayer,
  freeLayerId,
  freeLayerName,
  insertLayer,
  moveLayer,
  removeLayer,
} from "./layers.ts";

function layer(id: string, name = id): Layer {
  return { ...defaultRecipe().layers[0], id, name };
}

const ids = (layers: Layer[]) => layers.map((each) => each.id);

describe("layer stack operations", () => {
  test("free IDs and names skip the ones in use", () => {
    const layers = [layer("sample-1", "Sphere"), layer("sample-3", "Sphere 2")];
    expect(freeLayerId(layers, "sample")).toBe("sample-2");
    expect(freeLayerId(layers, "text")).toBe("text-1");
    expect(freeLayerName(layers, "Torus")).toBe("Torus");
    expect(freeLayerName(layers, "Sphere")).toBe("Sphere 3");
  });

  test("free names stay within the name limit", () => {
    const long = "x".repeat(RECIPE_LIMITS.nameLength + 10);
    const first = freeLayerName([], long);
    expect(first).toHaveLength(RECIPE_LIMITS.nameLength);
    const second = freeLayerName([layer("a", first)], long);
    expect(second).toHaveLength(RECIPE_LIMITS.nameLength);
    expect(second.endsWith(" 2")).toBe(true);
  });

  test("inserts above a layer, or on top", () => {
    const layers = [layer("a"), layer("b")];
    expect(ids(insertLayer(layers, layer("c"), "a"))).toEqual(["a", "c", "b"]);
    expect(ids(insertLayer(layers, layer("c")))).toEqual(["a", "b", "c"]);
    expect(ids(insertLayer(layers, layer("c"), "missing"))).toEqual(["a", "b", "c"]);
  });

  test("won't grow the stack past the layer limit", () => {
    const full = Array.from({ length: RECIPE_LIMITS.layers }, (_, i) => layer(`l${String(i)}`));
    expect(canAddLayer(full)).toBe(false);
    expect(canAddLayer(full.slice(1))).toBe(true);
    expect(insertLayer(full, layer("extra"))).toBe(full);
    expect(duplicateLayer(full, "l0")).toBe(full);
  });

  test("duplicates a deep copy above the original", () => {
    const layers = [layer("sample-1", "Sphere"), layer("sample-2", "Cone")];
    const result = duplicateLayer(layers, "sample-1");
    expect(ids(result)).toEqual(["sample-1", "sample-3", "sample-2"]);
    const [original, copy] = result;
    expect(copy).toEqual({ ...original, id: "sample-3", name: "Sphere copy" });
    expect("center" in copy && "center" in original && copy.center !== original.center).toBe(true);
  });

  test("removes and moves layers", () => {
    const layers = [layer("a"), layer("b"), layer("c")];
    expect(ids(removeLayer(layers, "b"))).toEqual(["a", "c"]);
    expect(removeLayer(layers, "missing")).toBe(layers);
    expect(ids(moveLayer(layers, "a", 2))).toEqual(["b", "c", "a"]);
    expect(ids(moveLayer(layers, "c", 0))).toEqual(["c", "a", "b"]);
    expect(ids(moveLayer(layers, "b", 9))).toEqual(["a", "c", "b"]);
    expect(moveLayer(layers, "a", -1)).toBe(layers);
    expect(moveLayer(layers, "missing", 1)).toBe(layers);
  });

  test("changes one layer", () => {
    const layers = [layer("a"), layer("b")];
    const result = changeLayer(layers, "b", (each) => ({ ...each, visible: false }));
    expect(result.map((each) => each.visible)).toEqual([true, false]);
    expect(result[0]).toBe(layers[0]);
    expect(changeLayer(layers, "missing", (each) => each)).toBe(layers);
  });
});
