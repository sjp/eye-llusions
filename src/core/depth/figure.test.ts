import { describe, expect, test } from "vitest";
import { defaultRecipe, type SampleLayer } from "../recipe.ts";
import { compositeDepth } from "./composite.ts";
import { FIGURE_IDS, prepareFigure, rasteriseFigure } from "./figure.ts";

const SIZE = 64;

/** A disc of depth 0.5 with a nearer square in its middle, on a transparent ground. */
function testFigure() {
  const rgba = new Uint8Array(SIZE * SIZE * 4);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const i = (y * SIZE + x) * 4;
      const inDisc = Math.hypot(x + 0.5 - SIZE / 2, y + 0.5 - SIZE / 2) < SIZE / 2 - 4;
      const inSquare = Math.abs(x + 0.5 - SIZE / 2) < 8 && Math.abs(y + 0.5 - SIZE / 2) < 8;
      rgba[i] = inSquare ? 255 : 128;
      rgba[i + 3] = inDisc ? 255 : 0;
    }
  }
  return prepareFigure(rgba, SIZE);
}

function layer(overrides: Partial<SampleLayer> = {}): SampleLayer {
  return {
    kind: "sample",
    id: "figure",
    name: "Figure",
    visible: true,
    blend: "max",
    depth: 1,
    shape: { type: "figure", figure: "heart" },
    center: { x: 0.5, y: 0.5 },
    size: 1,
    ...overrides,
  };
}

function draw(width: number, height: number, overrides: Partial<SampleLayer> = {}) {
  const target = {
    depth: new Float32Array(width * height),
    coverage: new Float32Array(width * height),
  };
  rasteriseFigure(
    layer(overrides),
    { recipe: defaultRecipe(), width, height, target },
    testFigure(),
  );
  return target;
}

describe("figures", () => {
  test("each bundled figure has a picture, and each picture is listed", () => {
    const files = Object.keys(import.meta.glob("../../assets/figures/*.png")).map((path) =>
      path.replace(/^.*\/(.+)\.png$/, "$1"),
    );
    expect(files.toSorted()).toEqual(FIGURE_IDS.toSorted());
  });

  test("prepareFigure keeps halved copies down to a small size", () => {
    expect(testFigure().levels.map((level) => level.size)).toEqual([64, 32, 16]);
    expect(() => prepareFigure(new Uint8Array(10), 4)).toThrow(RangeError);
  });

  test("fills a square of the layer's size, centred on the layer", () => {
    const { depth, coverage } = draw(200, 100, { center: { x: 0.25, y: 0.5 }, size: 0.8 });
    const at = (x: number, y: number) => y * 200 + x;
    expect(coverage[at(50, 50)]).toBe(1);
    expect(depth[at(50, 50)]).toBeCloseTo(1, 5);
    expect(depth[at(50, 30)]).toBeCloseTo(128 / 255, 5);
    expect(coverage[at(150, 50)]).toBe(0);
    expect(coverage[at(50, 6)]).toBe(0);
    expect(coverage[at(11, 50)]).toBe(0);
  });

  test("keeps depth unpremultiplied along anti-aliased edges", () => {
    const { depth, coverage } = draw(100, 100);
    const edges = Array.from(depth).filter((_, i) => coverage[i] > 0 && coverage[i] < 1);
    expect(edges.length).toBeGreaterThan(0);
    expect(Math.max(...edges.map((value) => Math.abs(value - 128 / 255)))).toBeLessThan(1e-5);
  });

  test("the core sample rasteriser leaves figures to the renderer", async () => {
    const depth = await compositeDepth({ ...defaultRecipe(), layers: [layer()] }, 16, 16);
    expect(depth.every((value) => value === 0)).toBe(true);
  });
});
