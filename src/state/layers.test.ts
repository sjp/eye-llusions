import { describe, expect, test } from "vitest";
import { strokeCost } from "../core/depth/drawing.ts";
import { RECIPE_LIMITS } from "../core/parseRecipe.ts";
import { defaultRecipe, type DrawingLayer, type Layer, type Stroke } from "../core/recipe.ts";
import {
  addStroke,
  canAddLayer,
  canDuplicateLayer,
  changeLayer,
  duplicateLayer,
  freeLayerId,
  freeLayerName,
  insertLayer,
  moveLayer,
  removeLayer,
  duplicateProblem,
  selectedLayer,
  strokeFits,
  strokeRoom,
} from "./layers.ts";

const ASPECT = 16 / 9;

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
    expect(duplicateLayer(full, "l0", ASPECT)).toBe(full);
  });

  test("duplicates a deep copy above the original", () => {
    const layers = [layer("sample-1", "Sphere"), layer("sample-2", "Cone")];
    const result = duplicateLayer(layers, "sample-1", ASPECT);
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

function drawing(id: string, strokes: Stroke[] = []): DrawingLayer {
  return {
    kind: "drawing",
    id,
    name: id,
    visible: true,
    blend: "max",
    depth: 1,
    strokes,
  };
}

function strokeOf(points: number): Stroke {
  return {
    brush: { size: 0.1, softness: 0, mode: "set", value: 1 },
    points: Array.from({ length: points * 2 }, () => 0.5),
  };
}

describe("selection and strokes", () => {
  test("the selected layer falls back to the top one", () => {
    const layers = [layer("a"), layer("b")];
    expect(selectedLayer(layers, "a")?.id).toBe("a");
    expect(selectedLayer(layers, "gone")?.id).toBe("b");
    expect(selectedLayer([], undefined)).toBeUndefined();
  });

  test("adds strokes to drawing layers only", () => {
    const layers: Layer[] = [layer("a"), drawing("d")];
    const added = addStroke(layers, "d", strokeOf(2));
    expect(added[1]).toMatchObject({ strokes: [strokeOf(2)] });
    expect(addStroke(layers, "a", strokeOf(2))[0]).toBe(layers[0]);
  });

  test("stroke room counts points across the recipe and strokes on the layer", () => {
    expect(strokeRoom([drawing("d")], "d")).toBe(RECIPE_LIMITS.pointsPerStroke);
    const busy = [
      drawing("d"),
      drawing(
        "e",
        Array.from({ length: 12 }, () => strokeOf(4000)),
      ),
    ];
    expect(strokeRoom(busy, "d")).toBe(RECIPE_LIMITS.pointsTotal - 48_000);
    const full = drawing(
      "d",
      Array.from({ length: RECIPE_LIMITS.strokesPerLayer }, () => strokeOf(1)),
    );
    expect(strokeRoom([full], "d")).toBe(0);
  });

  test("won't duplicate a drawing past the recipe's point total", () => {
    const strokes = Array.from({ length: 7 }, () => strokeOf(4000));
    const layers: Layer[] = [drawing("d", strokes), layer("a")];
    expect(canDuplicateLayer(layers, "d", ASPECT)).toBe(false);
    expect(duplicateLayer(layers, "d", ASPECT)).toBe(layers);
    expect(canDuplicateLayer(layers, "a", ASPECT)).toBe(true);
    expect(canDuplicateLayer(layers, "missing", ASPECT)).toBe(false);

    const exact: Layer[] = [drawing("d", strokes.slice(0, 6)), drawing("e", [strokeOf(2000)])];
    expect(canDuplicateLayer(exact, "d", ASPECT)).toBe(true);
    expect(duplicateLayer(exact, "d", ASPECT)).toHaveLength(3);
    const over: Layer[] = [drawing("d", strokes.slice(0, 6)), drawing("e", [strokeOf(2001)])];
    expect(canDuplicateLayer(over, "d", ASPECT)).toBe(false);
    expect(canDuplicateLayer(over, "e", ASPECT)).toBe(true);
    expect(duplicateProblem(over, "d", ASPECT)).toBe("points");
  });

  // Crosses the canvas once with a brush a tenth of its height.
  const line: Stroke = {
    brush: { size: 0.1, softness: 0, mode: "set", value: 1 },
    points: [0, 0.5, 1, 0.5],
  };
  const fits = Math.floor(RECIPE_LIMITS.drawingArea / strokeCost(line, ASPECT));

  test("a stroke fits only within the recipe's drawing area", () => {
    const layers: Layer[] = [
      drawing(
        "d",
        Array.from({ length: fits - 1 }, () => line),
      ),
      drawing("e"),
    ];
    expect(strokeFits(layers, "e", line, ASPECT)).toBe(true);
    const full = addStroke(layers, "e", line);
    expect(strokeFits(full, "e", line, ASPECT)).toBe(false);
    expect(strokeFits(full, "e", strokeOf(1), ASPECT)).toBe(true);
    expect(strokeFits(layers, "e", strokeOf(RECIPE_LIMITS.pointsPerStroke + 1), ASPECT)).toBe(
      false,
    );
  });

  test("won't duplicate a drawing past the recipe's drawing area", () => {
    const half = Math.floor(fits / 2);
    const layers: Layer[] = [
      drawing(
        "d",
        Array.from({ length: half }, () => line),
      ),
      drawing("e", [line, line]),
    ];
    expect(duplicateProblem(layers, "d", ASPECT)).toBe(
      2 * half + 2 > fits ? "drawingArea" : undefined,
    );
    const over: Layer[] = [
      drawing(
        "d",
        Array.from({ length: half + 1 }, () => line),
      ),
      layer("a"),
    ];
    expect(duplicateProblem(over, "d", ASPECT)).toBe("drawingArea");
    expect(duplicateLayer(over, "d", ASPECT)).toBe(over);
    expect(duplicateProblem(over, "a", ASPECT)).toBeUndefined();
  });
});
