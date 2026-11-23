import { describe, expect, test } from "vitest";
import { defaultRecipe, type Layer, type Recipe, type SampleLayer } from "../recipe.ts";
import { compositeDepth } from "./composite.ts";
import type { RasteriserRegistry } from "./raster.ts";

const WIDTH = 4;
const HEIGHT = 1;

/**
 * A stand-in sample rasteriser: the layer's `size` is its depth, and `center.x` is its
 * coverage over the left half of the row (the right half is uncovered).
 */
const FLAT: RasteriserRegistry = {
  sample: (layer, { width, target }) => {
    target.depth.fill(layer.size);
    target.coverage.fill(layer.center.x, 0, width / 2);
  },
};

function flat(depth: number, overrides: Partial<SampleLayer> = {}, coverage = 1): SampleLayer {
  return {
    kind: "sample",
    id: `layer${String(depth)}`,
    name: "Layer",
    visible: true,
    blend: "max",
    depth: 1,
    shape: { type: "sphere" },
    center: { x: coverage, y: 0.5 },
    size: depth,
    ...overrides,
  };
}

function recipe(...layers: Layer[]): Recipe {
  return { ...defaultRecipe(), layers };
}

async function composite(...layers: Layer[]): Promise<number[]> {
  return Array.from(await compositeDepth(recipe(...layers), WIDTH, HEIGHT, FLAT));
}

describe("compositeDepth", () => {
  test("is flat and far with no layers", async () => {
    expect(await composite()).toEqual([0, 0, 0, 0]);
  });

  test("keeps the nearer depth in max mode", async () => {
    expect(await composite(flat(0.5), flat(0.25))).toEqual([0.5, 0.5, 0, 0]);
    expect(await composite(flat(0.25), flat(0.5))).toEqual([0.5, 0.5, 0, 0]);
  });

  test("adds and subtracts, clamped to [0, 1]", async () => {
    expect(await composite(flat(0.5), flat(0.25, { blend: "add" }))).toEqual([0.75, 0.75, 0, 0]);
    expect(await composite(flat(0.75), flat(0.5, { blend: "add" }))).toEqual([1, 1, 0, 0]);
    expect(await composite(flat(0.5), flat(0.25, { blend: "subtract" }))).toEqual([
      0.25, 0.25, 0, 0,
    ]);
    expect(await composite(flat(0.25), flat(0.5, { blend: "subtract" }))).toEqual([0, 0, 0, 0]);
  });

  test("replaces what is below where covered", async () => {
    expect(await composite(flat(0.75), flat(0.25, { blend: "replace" }))).toEqual([
      0.25, 0.25, 0, 0,
    ]);
  });

  test("blends through partial coverage", async () => {
    const half = (blend: Layer["blend"]) => flat(0.5, { blend }, 0.5);
    expect(await composite(flat(1), half("replace"))).toEqual([0.75, 0.75, 0, 0]);
    expect(await composite(flat(0.25), half("max"))).toEqual([0.375, 0.375, 0, 0]);
    expect(await composite(flat(0.25), half("add"))).toEqual([0.5, 0.5, 0, 0]);
    expect(await composite(flat(0.75), half("subtract"))).toEqual([0.5, 0.5, 0, 0]);
  });

  test("scales each layer by its strength", async () => {
    expect(await composite(flat(0.5, { depth: 0.5 }))).toEqual([0.25, 0.25, 0, 0]);
    expect(await composite(flat(1), flat(1, { blend: "replace", depth: 0.25 }))).toEqual([
      0.25, 0.25, 0, 0,
    ]);
  });

  test("applies layers bottom to top", async () => {
    const add = flat(0.5, { blend: "add" });
    const replace = flat(0.25, { blend: "replace" });
    expect(await composite(add, replace)).toEqual([0.25, 0.25, 0, 0]);
    expect(await composite(replace, add)).toEqual([0.75, 0.75, 0, 0]);
  });

  test("skips invisible layers", async () => {
    expect(await composite(flat(0.5), flat(0.25, { blend: "replace", visible: false }))).toEqual([
      0.5, 0.5, 0, 0,
    ]);
  });

  test("skips kinds without a rasteriser", async () => {
    const text: Layer = {
      kind: "text",
      id: "text",
      name: "Text",
      visible: true,
      blend: "replace",
      depth: 1,
      text: "Hi",
      font: "sans",
      size: 0.2,
      center: { x: 0.5, y: 0.5 },
      edge: "flat",
      edgeWidth: 0,
    };
    expect(await composite(flat(0.5), text)).toEqual([0.5, 0.5, 0, 0]);
  });

  test("gives each rasteriser cleared buffers and waits for async ones", async () => {
    const registry: RasteriserRegistry = {
      sample: async (layer, { target }) => {
        expect(Array.from(target.depth)).toEqual([0, 0]);
        expect(Array.from(target.coverage)).toEqual([0, 0]);
        await Promise.resolve();
        target.depth.fill(layer.size);
        target.coverage.fill(1);
      },
    };
    const depth = await compositeDepth(
      recipe(flat(0.5), flat(0.25, { blend: "add" })),
      2,
      1,
      registry,
    );
    expect(Array.from(depth)).toEqual([0.75, 0.75]);
  });

  test("awaits the pause before each visible layer and stops when it throws", async () => {
    const steps: string[] = [];
    const registry: RasteriserRegistry = {
      sample: (layer) => {
        steps.push(`layer ${String(layer.size)}`);
      },
    };
    const layers = recipe(flat(0.5), flat(0.25, { visible: false }), flat(0.75));
    await compositeDepth(layers, 2, 1, registry, () => {
      steps.push("pause");
      return Promise.resolve();
    });
    expect(steps).toEqual(["pause", "layer 0.5", "pause", "layer 0.75"]);

    let pauses = 0;
    const stopped = compositeDepth(layers, 2, 1, registry, () => {
      pauses++;
      return pauses > 1 ? Promise.reject(new Error("stop")) : Promise.resolve();
    });
    await expect(stopped).rejects.toThrow("stop");
  });

  test("rejects invalid sizes", async () => {
    await expect(compositeDepth(recipe(), 0, 1)).rejects.toThrow(RangeError);
    await expect(compositeDepth(recipe(), 1.5, 1)).rejects.toThrow(RangeError);
  });
});
