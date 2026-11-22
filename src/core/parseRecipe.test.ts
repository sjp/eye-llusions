import { describe, expect, test } from "vitest";
import { RECIPE_LIMITS, RecipeError, parseRecipe } from "./parseRecipe.ts";
import { createRandom } from "./random.ts";
import { scaleLimits } from "./texture/scale.ts";
import { defaultRecipe, type Layer, type Recipe, type SampleLayer, type Stroke } from "./recipe.ts";

type Data = Record<string, unknown>;

const sphere = defaultRecipe().layers[0] as SampleLayer;

function stroke(points: number): Stroke {
  return {
    brush: { size: 0.05, softness: 0.5, mode: "raise", value: 0.25 },
    points: Array.from({ length: points * 2 }, (_, i) => (i % 7) / 7),
  };
}

function fullRecipe(): Recipe {
  return {
    ...defaultRecipe(),
    seed: 0xffffffff,
    layers: [
      { ...sphere, shape: { type: "ripples", rings: 5 } },
      {
        kind: "sample",
        id: "stairs",
        name: "Stairs",
        visible: false,
        blend: "add",
        depth: 0.5,
        shape: { type: "spiralStairs", steps: 12, turns: 1.5 },
        center: { x: -0.25, y: 1.25 },
        size: 0.3,
      },
      {
        kind: "text",
        id: "title",
        name: "Title",
        visible: true,
        blend: "replace",
        depth: 0.8,
        text: "Hello\nworld",
        font: "display-1",
        size: 0.2,
        center: { x: 0.5, y: 0.3 },
        edge: "bevel",
        edgeWidth: 0.02,
      },
      {
        kind: "drawing",
        id: "doodle",
        name: "Doodle",
        visible: true,
        blend: "subtract",
        depth: 0.3,
        strokes: [stroke(1), stroke(20)],
      },
      {
        kind: "image",
        id: "photo",
        name: "Photo",
        visible: true,
        blend: "max",
        depth: 1,
        asset: "img_1",
        fit: "cover",
        invert: true,
        levels: { black: 0.1, white: 0.9 },
        blur: 0.01,
        posterize: 4,
        threshold: null,
      },
      { ...sphere, id: "heart", shape: { type: "figure", figure: "heart" } },
    ],
    texture: {
      generator: { type: "colourNoise" },
      palette: { type: "custom", stops: ["#000000", "#ff8800", "#ffffff"] },
      scale: 2,
      seed: 123,
    },
    view: { repeats: 10, depthOfField: 0.25, mode: "cross" },
    assets: {
      img_1: { format: "gray", width: 3, height: 2, data: new Uint8Array([0, 1, 2, 3, 4, 5]) },
      tile: { format: "rgba", width: 1, height: 1, data: new Uint8Array([1, 2, 3, 4]) },
    },
  };
}

const DELETE = Symbol("delete");

/** Reads a dotted path such as `layers.0.depth` from untyped data. */
function get(data: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((value, key) => (value as Data)[key], data);
}

/** A clone of the full recipe with the value at a dotted path replaced or deleted. */
function withValue(path: string, value: unknown): unknown {
  const recipe = structuredClone(fullRecipe());
  const keys = path.split(".");
  const last = keys.pop() as string;
  const target = (keys.length === 0 ? recipe : get(recipe, keys.join("."))) as Data;
  if (value === DELETE) {
    Reflect.deleteProperty(target, last);
  } else {
    target[last] = value;
  }
  return recipe;
}

function errorOf(input: unknown): RecipeError {
  try {
    parseRecipe(input);
  } catch (error) {
    if (error instanceof RecipeError) {
      return error;
    }
    throw error;
  }
  throw new Error("expected parseRecipe to throw");
}

describe("parseRecipe accepts", () => {
  test("a structured clone of the default recipe", () => {
    const recipe = defaultRecipe();
    expect(parseRecipe(structuredClone(recipe))).toEqual(recipe);
  });

  test("the default recipe after a JSON round trip", () => {
    const json = JSON.stringify(defaultRecipe());
    expect(parseRecipe(JSON.parse(json))).toEqual(defaultRecipe());
  });

  test("a recipe using every layer kind, a custom palette and assets", () => {
    const recipe = fullRecipe();
    expect(parseRecipe(structuredClone(recipe))).toEqual(recipe);
  });

  test("a recipe without assets, as share links carry it", () => {
    expect(parseRecipe(withValue("assets", DELETE)).assets).toEqual({});
  });

  test("objects without a prototype", () => {
    const input: unknown = Object.assign(Object.create(null), defaultRecipe());
    expect(parseRecipe(input)).toEqual(defaultRecipe());
  });

  test("Uint8ClampedArray asset data, returned as a Uint8Array", () => {
    const input = withValue("assets.tile.data", new Uint8ClampedArray([9, 8, 7, 6]));
    const { data } = parseRecipe(input).assets.tile;
    expect(data).toBeInstanceOf(Uint8Array);
    expect(Array.from(data)).toEqual([9, 8, 7, 6]);
  });

  test("a threshold in place of null", () => {
    const layer = parseRecipe(withValue("layers.4.threshold", 0.5)).layers[4];
    expect(layer).toMatchObject({ posterize: 4, threshold: 0.5 });
  });

  test("upper-case colours, normalised to lower case", () => {
    const input = withValue("texture.palette.stops", ["#ABCDEF", "#000000"]);
    expect(parseRecipe(input).texture.palette).toEqual({
      type: "custom",
      stops: ["#abcdef", "#000000"],
    });
  });

  test("an asset ID of __proto__, kept as plain data", () => {
    const input = {};
    Object.defineProperty(input, "__proto__", {
      value: { format: "gray", width: 1, height: 1, data: new Uint8Array(1) },
      enumerable: true,
    });
    const { assets } = parseRecipe(withValue("assets", input));
    expect(Object.getPrototypeOf(assets)).toBe(Object.prototype);
    expect(Object.hasOwn(assets, "__proto__")).toBe(true);
  });

  test("a recipe exactly at the layer and stroke limits", () => {
    const drawing: Layer = {
      kind: "drawing",
      id: "drawing",
      name: "Drawing",
      visible: true,
      blend: "add",
      depth: 1,
      strokes: Array.from({ length: RECIPE_LIMITS.strokesPerLayer }, (_, i) =>
        stroke(i === 0 ? RECIPE_LIMITS.pointsPerStroke : 1),
      ),
    };
    const recipe: Recipe = {
      ...defaultRecipe(),
      layers: [
        drawing,
        ...Array.from({ length: RECIPE_LIMITS.layers - 1 }, (_, i) => ({
          ...sphere,
          id: `layer-${String(i)}`,
        })),
      ],
    };
    expect(parseRecipe(recipe)).toEqual(recipe);
  });
});

describe("parseRecipe returns a fresh recipe", () => {
  test("that shares no objects or buffers with the input", () => {
    const input = fullRecipe();
    const output = parseRecipe(input);
    expect(output).not.toBe(input);
    expect(output.layers[0]).not.toBe(input.layers[0]);
    input.assets.img_1.data.fill(255);
    expect(output.assets.img_1.data[0]).toBe(0);
  });
});

describe("parseRecipe clamps finite numbers into range", () => {
  test.each<[string, unknown, unknown]>([
    ["aspect", -3, 0.2],
    ["view.repeats", 1e9, 32],
    ["view.depthOfField", 0, 0.05],
    ["view.depthOfField", 1, 0.9],
    ["layers.0.depth", 1.5, 1],
    ["layers.0.shape.rings", 1000, 32],
    ["layers.1.center", { x: -9, y: 9 }, { x: -0.5, y: 1.5 }],
    ["layers.3.strokes.0.points", [-9, 9], [-0.5, 1.5]],
    [
      "texture.generator",
      { type: "fractalNoise", octaves: 9 },
      { type: "fractalNoise", octaves: 6 },
    ],
    ["texture.generator", { type: "cells", shading: -1 }, { type: "cells", shading: 0 }],
    [
      "texture.generator",
      { type: "scatteredShapes", density: 2 },
      { type: "scatteredShapes", density: 1 },
    ],
    [
      "texture.generator",
      { type: "tile", asset: "tile-1", divisions: 9, jitter: 2 },
      { type: "tile", asset: "tile-1", divisions: 4, jitter: 1 },
    ],
  ])("%s", (path, value, expected) => {
    expect(get(parseRecipe(withValue(path, value)), path)).toEqual(expected);
  });
});

describe("parseRecipe clamps the texture scale", () => {
  test.each([1e-9, 1e9])("%f into the range for the view", (scale) => {
    const { aspect, view, texture } = fullRecipe();
    const { min, max } = scaleLimits(texture.generator.type, aspect, view.repeats);
    const parsed = parseRecipe(withValue("texture.scale", scale)).texture.scale;
    expect(parsed).toBe(scale < 1 ? min : max);
  });
});

describe("parseRecipe rejects", () => {
  test.each([null, undefined, 42, "recipe", [], new Date(), new Map()])("the input %s", (input) => {
    expect(errorOf(input).path).toBe("");
  });

  const layerCopies = (count: number) => Array.from({ length: count }, () => sphere);
  const strokes = (count: number, points: number) =>
    Array.from({ length: count }, () => stroke(points));

  test.each<[string, string, unknown, string?]>([
    ["another version", "version", 2],
    ["a string version", "version", "1"],
    ["an unknown top-level field", "extra", true],
    ["an unknown nested field", "view.zoom", 2],
    ["a missing field", "texture", DELETE],
    ["a missing layer field", "layers.1.visible", DELETE, "layers[1].visible"],
    ["a field of another layer kind", "layers.2.strokes", [], "layers[2].strokes"],
    ["a negative seed", "seed", -1],
    ["a fractional seed", "seed", 1.5],
    ["a seed over 32 bits", "seed", 2 ** 32],
    ["a negative texture seed", "texture.seed", -1],
    ["NaN", "aspect", Number.NaN],
    ["Infinity", "view.repeats", Infinity],
    ["a numeric string", "layers.0.depth", "1", "layers[0].depth"],
    ["a fractional count", "layers.0.shape.rings", 2.5, "layers[0].shape.rings"],
    ["an unknown layer kind", "layers.0.kind", "model", "layers[0].kind"],
    ["an unknown shape", "layers.0.shape", { type: "cube" }, "layers[0].shape.type"],
    [
      "an unknown figure",
      "layers.0.shape",
      { type: "figure", figure: "dragon" },
      "layers[0].shape.figure",
    ],
    ["an unknown blend mode", "layers.0.blend", "multiply", "layers[0].blend"],
    ["an unknown view mode", "view.mode", "parallel"],
    ["an unknown generator", "texture.generator.type", "photo"],
    [
      "a fractional tile division",
      "texture.generator",
      { type: "tile", asset: "tile-1", divisions: 1.5, jitter: 0 },
      "texture.generator.divisions",
    ],
    [
      "an invalid tile asset ID",
      "texture.generator",
      { type: "tile", asset: "a b", divisions: 1, jitter: 0 },
      "texture.generator.asset",
    ],
    [
      "a fractional octave count",
      "texture.generator",
      { type: "fractalNoise", octaves: 2.5 },
      "texture.generator.octaves",
    ],
    [
      "a missing generator parameter",
      "texture.generator",
      { type: "cells" },
      "texture.generator.shading",
    ],
    ["a non-boolean flag", "layers.0.visible", 1, "layers[0].visible"],
    ["an invalid layer ID", "layers.0.id", "a b", "layers[0].id"],
    ["an empty layer ID", "layers.0.id", "", "layers[0].id"],
    ["a duplicate layer ID", "layers.1.id", sphere.id, "layers[1].id"],
    ["an over-long name", "layers.0.name", "n".repeat(65), "layers[0].name"],
    ["over-long text", "layers.2.text", "t".repeat(1001), "layers[2].text"],
    ["a malformed colour", "texture.palette.stops.1", "red", "texture.palette.stops[1]"],
    ["one palette stop", "texture.palette.stops", ["#000000"]],
    ["too many palette stops", "texture.palette.stops", Array.from({ length: 9 }, () => "#000")],
    ["inverted levels", "layers.4.levels.black", 0.95, "layers[4].levels"],
    ["an empty stroke", "layers.3.strokes.0.points", [], "layers[3].strokes[0].points"],
    [
      "an odd coordinate count",
      "layers.3.strokes.0.points",
      [0, 0, 1],
      "layers[3].strokes[0].points",
    ],
    [
      "a missing coordinate",
      "layers.3.strokes.0.points",
      [0, undefined],
      "layers[3].strokes[0].points[1]",
    ],
    ["too many layers", "layers", layerCopies(RECIPE_LIMITS.layers + 1)],
    [
      "too many strokes",
      "layers.3.strokes",
      strokes(RECIPE_LIMITS.strokesPerLayer + 1, 1),
      "layers[3].strokes",
    ],
    [
      "too many points in a stroke",
      "layers.3.strokes",
      strokes(1, RECIPE_LIMITS.pointsPerStroke + 1),
      "layers[3].strokes[0].points",
    ],
    [
      "too many points in the recipe",
      "layers.3.strokes",
      strokes(RECIPE_LIMITS.pointsTotal / 1000 + 1, 1000),
      `layers[3].strokes[${String(RECIPE_LIMITS.pointsTotal / 1000)}].points`,
    ],
    ["assets that aren't an object", "assets", []],
    ["an invalid asset ID", "assets.a/b", fullRecipe().assets.tile, "assets.a/b"],
    ["asset data in a plain array", "assets.tile.data", [1, 2, 3, 4]],
    ["16-bit asset data", "assets.tile.data", new Uint16Array(4)],
    ["asset data of the wrong length", "assets.img_1.format", "rgba", "assets.img_1.data"],
    ["a zero-width asset", "assets.tile.width", 0],
    ["an oversized asset", "assets.tile.width", 4096],
    [
      "too many assets",
      "assets",
      Object.fromEntries(
        Array.from({ length: RECIPE_LIMITS.assets + 1 }, (_, i) => [
          `a${String(i)}`,
          fullRecipe().assets.tile,
        ]),
      ),
    ],
  ])("%s", (_, path, value, errorPath = path) => {
    const error = errorOf(withValue(path, value));
    expect(error.path).toBe(errorPath);
    expect(error.message.startsWith(errorPath)).toBe(true);
  });

  test("assets that are too large in total", () => {
    const side = RECIPE_LIMITS.assetSide;
    const big = { format: "rgba", width: side, height: side, data: new Uint8Array(side ** 2 * 4) };
    const count = Math.floor(RECIPE_LIMITS.assetBytesTotal / big.data.length) + 1;
    const assets = Object.fromEntries(
      Array.from({ length: count }, (_, i) => [`a${String(i)}`, big]),
    );
    expect(errorOf({ ...defaultRecipe(), assets }).path).toBe("assets");
  });

  test("an over-long unknown key without echoing all of it", () => {
    const error = errorOf(withValue("k".repeat(100_000), 1));
    expect(error.message.length).toBeLessThan(200);
  });
});

describe("parseRecipe throws only RecipeError for hostile input", () => {
  test("a getter that throws", () => {
    const input = withValue("seed", 1);
    Object.defineProperty(input, "seed", {
      enumerable: true,
      get() {
        throw new Error("boom");
      },
    });
    expect(errorOf(input).message).toBe("the recipe could not be read");
  });

  test("a proxy whose traps throw", () => {
    const trap = () => {
      throw new TypeError("trap");
    };
    const input = new Proxy({}, { getPrototypeOf: trap, ownKeys: trap, get: trap });
    expect(errorOf(input)).toBeInstanceOf(RecipeError);
  });

  test("an array claiming a huge length", () => {
    const layers: unknown[] = [];
    layers.length = 2 ** 32 - 1;
    expect(errorOf(withValue("layers", layers)).path).toBe("layers");
  });

  test("deeply nested objects", () => {
    let nested: unknown = {};
    for (let i = 0; i < 100_000; i++) {
      nested = { type: nested };
    }
    expect(errorOf(withValue("layers.0.shape", nested)).path).toBe("layers[0].shape.type");
  });

  test("thousands of random mutations of a valid recipe", () => {
    const random = createRandom(2024);
    const pick = <T>(items: readonly T[]): T => items[random.uint32() % items.length];
    const replacements: unknown[] = [
      null,
      undefined,
      -1,
      0,
      0.5,
      1,
      1e308,
      Number.NaN,
      "",
      "x",
      "#zzzzzz",
      true,
      [],
      {},
      [0],
      { type: "sphere" },
      new Uint8Array(3),
      Symbol("s"),
      () => 1,
      2 ** 32,
    ];
    let accepted = 0;
    let rejected = 0;
    const unexpected: unknown[] = [];
    for (let round = 0; round < 3000; round++) {
      const recipe: unknown = structuredClone(fullRecipe());
      let target = recipe as Data;
      let key = pick(Object.keys(target));
      for (let depth = 0; depth < 6; depth++) {
        const child = target[key];
        const keys = typeof child === "object" && child !== null ? Object.keys(child) : [];
        if (keys.length === 0 || ArrayBuffer.isView(child) || random.float() < 0.25) {
          break;
        }
        target = child as Data;
        key = pick(keys);
      }
      if (random.float() < 0.1) {
        Reflect.deleteProperty(target, key);
      } else {
        target[key] = pick(replacements);
      }
      try {
        parseRecipe(recipe);
        accepted++;
      } catch (error) {
        if (error instanceof RecipeError) {
          rejected++;
        } else {
          unexpected.push(error);
        }
      }
    }
    expect(unexpected).toEqual([]);
    expect(accepted).toBeGreaterThan(0);
    expect(rejected).toBeGreaterThan(0);
  });
});
