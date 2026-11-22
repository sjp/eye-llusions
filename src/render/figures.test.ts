import { describe, expect, test, vi } from "vitest";
import { FIGURE_IDS, prepareFigure, type FigureId } from "../core/depth/figure.ts";
import { defaultRecipe, type SampleLayer } from "../core/recipe.ts";
import { createSampleRasteriser, figureUrl } from "./figures.ts";

const solid = prepareFigure(new Uint8Array(4 * 4 * 4).fill(255), 4);

function context() {
  return {
    recipe: defaultRecipe(),
    width: 8,
    height: 8,
    target: { depth: new Float32Array(64), coverage: new Float32Array(64) },
  };
}

function layer(shape: SampleLayer["shape"]): SampleLayer {
  return {
    kind: "sample",
    id: "shape",
    name: "Shape",
    visible: true,
    blend: "max",
    depth: 1,
    shape,
    center: { x: 0.5, y: 0.5 },
    size: 1,
  };
}

describe("createSampleRasteriser", () => {
  test("draws procedural shapes without loading anything", async () => {
    const load = vi.fn<(id: FigureId) => Promise<typeof solid>>();
    const target = context();
    await createSampleRasteriser(load)(layer({ type: "sphere" }), target);
    expect(load).not.toHaveBeenCalled();
    expect(target.target.depth[4 * 8 + 4]).toBeGreaterThan(0.9);
  });

  test("loads each figure once and draws it", async () => {
    const load = vi.fn<(id: FigureId) => Promise<typeof solid>>(() => Promise.resolve(solid));
    const rasterise = createSampleRasteriser(load);
    const first = context();
    await rasterise(layer({ type: "figure", figure: "star" }), first);
    await rasterise(layer({ type: "figure", figure: "star" }), context());
    expect(load).toHaveBeenCalledTimes(1);
    expect(first.target.coverage.every((value) => value === 1)).toBe(true);
  });

  test("tries a failed figure again on the next render", async () => {
    const load = vi
      .fn<(id: FigureId) => Promise<typeof solid>>(() => Promise.resolve(solid))
      .mockRejectedValueOnce(new Error("offline"));
    const rasterise = createSampleRasteriser(load);
    await expect(rasterise(layer({ type: "figure", figure: "cat" }), context())).rejects.toThrow(
      "offline",
    );
    await rasterise(layer({ type: "figure", figure: "cat" }), context());
    expect(load).toHaveBeenCalledTimes(2);
  });

  test("every figure has a picture address", () => {
    for (const id of FIGURE_IDS) {
      expect(figureUrl(id)).toMatch(new RegExp(`${id}.*\\.png$`));
    }
  });
});
