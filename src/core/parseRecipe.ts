import {
  RECIPE_VERSION,
  clampDepthOfField,
  type Asset,
  type Brush,
  type DrawingLayer,
  type ImageLayer,
  type Layer,
  type Palette,
  type Point,
  type Recipe,
  type SampleLayer,
  type SampleShape,
  type Stroke,
  type TextLayer,
  type TextureGenerator,
  type TextureSpec,
} from "./recipe.ts";
import { FIGURE_IDS } from "./depth/figure.ts";
import { clampScale } from "./texture/scale.ts";

/**
 * Size limits for untrusted recipes. Counts beyond them are rejected; finite numbers
 * outside a field's range are clamped into it.
 */
export const RECIPE_LIMITS = {
  layers: 32,
  strokesPerLayer: 1000,
  pointsPerStroke: 4000,
  pointsTotal: 50_000,
  assets: 16,
  assetSide: 2048,
  assetBytesTotal: 64 * 1024 * 1024,
  textLength: 1000,
  nameLength: 64,
  idLength: 64,
  paletteStops: { min: 2, max: 8 },
} as const;

/** Thrown for any input that isn't a valid recipe. `path` locates the problem. */
export class RecipeError extends Error {
  readonly path: string;

  constructor(path: string, problem: string) {
    super(path === "" ? problem : `${path}: ${problem}`);
    this.name = "RecipeError";
    this.path = path;
  }
}

type Fields = Record<string, unknown>;

/** The most tile copies across one strip. */
const MAX_TILE_DIVISIONS = 4;

const ID_PATTERN = /^[\w-]+$/;
const COLOUR_PATTERN = /^#[\da-f]{6}$/;
/** Positions may lie partly off the canvas. */
const POSITION_RANGE = [-0.5, 1.5] as const;

function describe(value: unknown): string {
  if (value === null || value === undefined) {
    return String(value);
  }
  if (Array.isArray(value)) {
    return "an array";
  }
  return typeof value === "object" ? "an object" : `a ${typeof value}`;
}

function isFields(value: unknown): value is Fields {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/** A plain object with exactly the given keys, apart from any listed as optional. */
function object(
  value: unknown,
  path: string,
  keys: readonly string[],
  optional: readonly string[] = [],
): Fields {
  if (!isFields(value)) {
    throw new RecipeError(path, `expected an object, got ${describe(value)}`);
  }
  for (const key of Object.keys(value)) {
    if (!keys.includes(key) && !optional.includes(key)) {
      throw new RecipeError(join(path, key.slice(0, RECIPE_LIMITS.idLength)), "unknown field");
    }
  }
  for (const key of keys) {
    if (!Object.hasOwn(value, key)) {
      throw new RecipeError(join(path, key), "missing");
    }
  }
  return value;
}

function join(path: string, key: string): string {
  return path === "" ? key : `${path}.${key}`;
}

function array(value: unknown, path: string, max: number): readonly unknown[] {
  if (!Array.isArray(value)) {
    throw new RecipeError(path, `expected an array, got ${describe(value)}`);
  }
  const items: readonly unknown[] = value;
  if (items.length > max) {
    throw new RecipeError(path, `more than ${String(max)} items`);
  }
  return items;
}

function number(value: unknown, path: string, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new RecipeError(path, `expected a finite number, got ${describe(value)}`);
  }
  return Math.min(max, Math.max(min, value));
}

function integer(value: unknown, path: string, min: number, max: number): number {
  const result = number(value, path, min, max);
  if (!Number.isInteger(result)) {
    throw new RecipeError(path, "expected an integer");
  }
  return result;
}

function boolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") {
    throw new RecipeError(path, `expected a boolean, got ${describe(value)}`);
  }
  return value;
}

function string(value: unknown, path: string, maxLength: number): string {
  if (typeof value !== "string") {
    throw new RecipeError(path, `expected a string, got ${describe(value)}`);
  }
  if (value.length > maxLength) {
    throw new RecipeError(path, `longer than ${String(maxLength)} characters`);
  }
  return value;
}

function uint32(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 0xffffffff) {
    throw new RecipeError(path, "expected an unsigned 32-bit integer");
  }
  return value;
}

function id(value: unknown, path: string): string {
  const result = string(value, path, RECIPE_LIMITS.idLength);
  if (!ID_PATTERN.test(result)) {
    throw new RecipeError(path, "IDs may only contain letters, digits, _ and -");
  }
  return result;
}

function oneOf<T extends string>(value: unknown, path: string, options: readonly T[]): T {
  const match = options.find((option) => option === value);
  if (match === undefined) {
    throw new RecipeError(path, `expected one of ${options.join(", ")}`);
  }
  return match;
}

/** The discriminant of a tagged union, read before the rest of the object. */
function tag<T extends string>(
  value: unknown,
  path: string,
  key: string,
  options: readonly T[],
): T {
  if (!isFields(value)) {
    throw new RecipeError(path, `expected an object, got ${describe(value)}`);
  }
  return oneOf(Object.hasOwn(value, key) ? value[key] : undefined, join(path, key), options);
}

function unreachable(value: never): never {
  throw new RecipeError("", `unexpected ${String(value)}`);
}

function nullable<T>(value: unknown, parse: (value: unknown) => T): T | null {
  return value === null ? null : parse(value);
}

function point(value: unknown, path: string): Point {
  const fields = object(value, path, ["x", "y"]);
  return {
    x: number(fields.x, join(path, "x"), ...POSITION_RANGE),
    y: number(fields.y, join(path, "y"), ...POSITION_RANGE),
  };
}

function sampleShape(value: unknown, path: string): SampleShape {
  const at = (key: string) => join(path, key);
  const type = tag(value, path, "type", [
    "sphere",
    "ripples",
    "pyramid",
    "torus",
    "spiralStairs",
    "figure",
  ]);
  switch (type) {
    case "sphere":
      object(value, path, ["type"]);
      return { type };
    case "ripples": {
      const fields = object(value, path, ["type", "rings"]);
      return { type, rings: integer(fields.rings, at("rings"), 1, 32) };
    }
    case "pyramid": {
      const fields = object(value, path, ["type", "sides"]);
      return { type, sides: integer(fields.sides, at("sides"), 3, 12) };
    }
    case "torus": {
      const fields = object(value, path, ["type", "thickness"]);
      return { type, thickness: number(fields.thickness, at("thickness"), 0.05, 0.95) };
    }
    case "spiralStairs": {
      const fields = object(value, path, ["type", "steps", "turns"]);
      return {
        type,
        steps: integer(fields.steps, at("steps"), 2, 64),
        turns: number(fields.turns, at("turns"), 0.25, 8),
      };
    }
    case "figure": {
      const fields = object(value, path, ["type", "figure"]);
      return { type, figure: oneOf(fields.figure, at("figure"), FIGURE_IDS) };
    }
    default:
      return unreachable(type);
  }
}

const COMMON_KEYS = ["kind", "id", "name", "visible", "blend", "depth"] as const;

const KIND_KEYS = {
  sample: ["shape", "center", "size"],
  text: ["text", "font", "size", "center", "edge", "edgeWidth"],
  drawing: ["strokes"],
  image: ["asset", "fit", "invert", "levels", "blur", "posterize", "threshold"],
} as const satisfies Record<Layer["kind"], readonly string[]>;

function brush(value: unknown, path: string): Brush {
  const at = (key: string) => join(path, key);
  const fields = object(value, path, ["size", "softness", "mode", "value"]);
  return {
    size: number(fields.size, at("size"), 0.001, 1),
    softness: number(fields.softness, at("softness"), 0, 1),
    mode: oneOf(fields.mode, at("mode"), ["set", "raise", "lower", "smooth"]),
    value: number(fields.value, at("value"), 0, 1),
  };
}

function stroke(value: unknown, path: string, budget: { points: number }): Stroke {
  const fields = object(value, path, ["brush", "points"]);
  const pointsPath = join(path, "points");
  const coordinates = array(fields.points, pointsPath, RECIPE_LIMITS.pointsPerStroke * 2);
  if (coordinates.length === 0 || coordinates.length % 2 !== 0) {
    throw new RecipeError(pointsPath, "expected a non-empty list of x, y pairs");
  }
  budget.points += coordinates.length / 2;
  if (budget.points > RECIPE_LIMITS.pointsTotal) {
    throw new RecipeError(
      pointsPath,
      `more than ${String(RECIPE_LIMITS.pointsTotal)} points in the recipe`,
    );
  }
  return {
    brush: brush(fields.brush, join(path, "brush")),
    points: coordinates.map((coordinate, index) =>
      number(coordinate, `${pointsPath}[${String(index)}]`, ...POSITION_RANGE),
    ),
  };
}

function layer(value: unknown, path: string, budget: { points: number }): Layer {
  const at = (key: string) => join(path, key);
  const kind = tag(value, path, "kind", ["sample", "text", "drawing", "image"]);
  const fields = object(value, path, [...COMMON_KEYS, ...KIND_KEYS[kind]]);
  const common = {
    id: id(fields.id, at("id")),
    name: string(fields.name, at("name"), RECIPE_LIMITS.nameLength),
    visible: boolean(fields.visible, at("visible")),
    blend: oneOf(fields.blend, at("blend"), ["max", "add", "subtract", "replace"]),
    depth: number(fields.depth, at("depth"), 0, 1),
  };
  switch (kind) {
    case "sample":
      return {
        kind,
        ...common,
        shape: sampleShape(fields.shape, at("shape")),
        center: point(fields.center, at("center")),
        size: number(fields.size, at("size"), 0.01, 4),
      } satisfies SampleLayer;
    case "text":
      return {
        kind,
        ...common,
        text: string(fields.text, at("text"), RECIPE_LIMITS.textLength),
        font: id(fields.font, at("font")),
        size: number(fields.size, at("size"), 0.01, 1),
        center: point(fields.center, at("center")),
        edge: oneOf(fields.edge, at("edge"), ["flat", "bevel", "round"]),
        edgeWidth: number(fields.edgeWidth, at("edgeWidth"), 0, 0.25),
      } satisfies TextLayer;
    case "drawing":
      return {
        kind,
        ...common,
        strokes: array(fields.strokes, at("strokes"), RECIPE_LIMITS.strokesPerLayer).map(
          (item, index) => stroke(item, `${at("strokes")}[${String(index)}]`, budget),
        ),
      } satisfies DrawingLayer;
    case "image": {
      const levelsPath = at("levels");
      const levels = object(fields.levels, levelsPath, ["black", "white"]);
      const black = number(levels.black, join(levelsPath, "black"), 0, 1);
      const white = number(levels.white, join(levelsPath, "white"), 0, 1);
      if (black >= white) {
        throw new RecipeError(levelsPath, "black must be below white");
      }
      return {
        kind,
        ...common,
        asset: id(fields.asset, at("asset")),
        fit: oneOf(fields.fit, at("fit"), ["contain", "cover", "stretch"]),
        invert: boolean(fields.invert, at("invert")),
        levels: { black, white },
        blur: number(fields.blur, at("blur"), 0, 0.25),
        posterize: nullable(fields.posterize, (v) => integer(v, at("posterize"), 2, 64)),
        threshold: nullable(fields.threshold, (v) => number(v, at("threshold"), 0, 1)),
      } satisfies ImageLayer;
    }
    default:
      return unreachable(kind);
  }
}

function generator(value: unknown, path: string): TextureGenerator {
  const at = (key: string) => join(path, key);
  const type = tag(value, path, "type", [
    "randomDots",
    "colourNoise",
    "fractalNoise",
    "cells",
    "scatteredShapes",
    "tile",
  ]);
  switch (type) {
    case "randomDots": {
      const fields = object(value, path, ["type", "density"]);
      return { type, density: number(fields.density, at("density"), 0, 1) };
    }
    case "colourNoise":
      object(value, path, ["type"]);
      return { type };
    case "fractalNoise": {
      const fields = object(value, path, ["type", "octaves"]);
      return { type, octaves: integer(fields.octaves, at("octaves"), 1, 6) };
    }
    case "cells": {
      const fields = object(value, path, ["type", "shading"]);
      return { type, shading: number(fields.shading, at("shading"), 0, 1) };
    }
    case "scatteredShapes": {
      const fields = object(value, path, ["type", "density"]);
      return { type, density: number(fields.density, at("density"), 0, 1) };
    }
    case "tile": {
      const fields = object(value, path, ["type", "asset", "divisions", "jitter"]);
      return {
        type,
        asset: id(fields.asset, at("asset")),
        divisions: integer(fields.divisions, at("divisions"), 1, MAX_TILE_DIVISIONS),
        jitter: number(fields.jitter, at("jitter"), 0, 1),
      };
    }
    default:
      return unreachable(type);
  }
}

function palette(value: unknown, path: string): Palette {
  const type = tag(value, path, "type", ["preset", "custom"]);
  switch (type) {
    case "preset":
      return { type, id: id(object(value, path, ["type", "id"]).id, join(path, "id")) };
    case "custom": {
      const stopsPath = join(path, "stops");
      const { min, max } = RECIPE_LIMITS.paletteStops;
      const stops = array(object(value, path, ["type", "stops"]).stops, stopsPath, max);
      if (stops.length < min) {
        throw new RecipeError(stopsPath, `fewer than ${String(min)} colours`);
      }
      return {
        type,
        stops: stops.map((stop, index) => {
          const colour = string(stop, `${stopsPath}[${String(index)}]`, 7).toLowerCase();
          if (!COLOUR_PATTERN.test(colour)) {
            throw new RecipeError(`${stopsPath}[${String(index)}]`, "expected #rrggbb");
          }
          return colour;
        }),
      };
    }
    default:
      return unreachable(type);
  }
}

/** The scale is clamped by the caller, since its range depends on the view. */
function texture(value: unknown, path: string): TextureSpec {
  const fields = object(value, path, ["generator", "palette", "scale", "seed"]);
  return {
    generator: generator(fields.generator, join(path, "generator")),
    palette: palette(fields.palette, join(path, "palette")),
    scale: number(fields.scale, join(path, "scale"), -Infinity, Infinity),
    seed: uint32(fields.seed, join(path, "seed")),
  };
}

/** Asset sizes must be exact, so they're rejected rather than clamped. */
function assetSide(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new RecipeError(path, "expected a positive integer");
  }
  if (value > RECIPE_LIMITS.assetSide) {
    throw new RecipeError(path, `more than ${String(RECIPE_LIMITS.assetSide)} pixels`);
  }
  return value;
}

function asset(value: unknown, path: string): Asset {
  const at = (key: string) => join(path, key);
  const fields = object(value, path, ["format", "width", "height", "data"]);
  const format = oneOf(fields.format, at("format"), ["gray", "rgba"]);
  const width = assetSide(fields.width, at("width"));
  const height = assetSide(fields.height, at("height"));
  const data = fields.data;
  if (!(data instanceof Uint8Array || data instanceof Uint8ClampedArray)) {
    throw new RecipeError(at("data"), "expected a Uint8Array");
  }
  if (data.length !== width * height * (format === "gray" ? 1 : 4)) {
    throw new RecipeError(at("data"), "length doesn't match the format and size");
  }
  return { format, width, height, data: new Uint8Array(data) };
}

function assets(value: unknown, path: string): Record<string, Asset> {
  if (!isFields(value)) {
    throw new RecipeError(path, `expected an object, got ${describe(value)}`);
  }
  const keys = Object.keys(value);
  if (keys.length > RECIPE_LIMITS.assets) {
    throw new RecipeError(path, `more than ${String(RECIPE_LIMITS.assets)} assets`);
  }
  let bytes = 0;
  const entries = keys.map((key): [string, Asset] => {
    const entry = asset(value[key], join(path, id(key, join(path, key))));
    bytes += entry.data.length;
    if (bytes > RECIPE_LIMITS.assetBytesTotal) {
      throw new RecipeError(path, "assets are too large in total");
    }
    return [key, entry];
  });
  // fromEntries defines own properties, so an ID such as __proto__ stays plain data.
  return Object.fromEntries(entries);
}

function recipe(value: unknown): Recipe {
  const fields = object(
    value,
    "",
    ["version", "aspect", "seed", "layers", "texture", "view"],
    ["assets"],
  );
  if (fields.version !== RECIPE_VERSION) {
    throw new RecipeError(
      "version",
      typeof fields.version === "number"
        ? `unsupported version ${String(fields.version)}`
        : "expected a version number",
    );
  }
  const seed = uint32(fields.seed, "seed");
  const budget = { points: 0 };
  const layers = array(fields.layers, "layers", RECIPE_LIMITS.layers).map((item, index) =>
    layer(item, `layers[${String(index)}]`, budget),
  );
  const ids = new Set<string>();
  for (const [index, { id: layerId }] of layers.entries()) {
    if (ids.has(layerId)) {
      throw new RecipeError(`layers[${String(index)}].id`, `duplicate layer ID ${layerId}`);
    }
    ids.add(layerId);
  }
  const view = object(fields.view, "view", ["repeats", "depthOfField", "mode"]);
  return clampScale({
    version: RECIPE_VERSION,
    aspect: number(fields.aspect, "aspect", 0.2, 5),
    seed,
    layers,
    texture: texture(fields.texture, "texture"),
    view: clampDepthOfField({
      repeats: number(view.repeats, "view.repeats", 2, 32),
      depthOfField: number(view.depthOfField, "view.depthOfField", 0.05, 0.9),
      mode: oneOf(view.mode, "view.mode", ["wall", "cross"]),
    }),
    assets: Object.hasOwn(fields, "assets") ? assets(fields.assets, "assets") : {},
  });
}

/**
 * Validates untrusted input, such as a decoded share link or PNG metadata, and returns
 * a fresh Recipe that shares nothing with it. Links carry no assets, so `assets` may be
 * absent. Throws only RecipeError.
 */
export function parseRecipe(input: unknown): Recipe {
  try {
    return recipe(input);
  } catch (error) {
    if (error instanceof RecipeError) {
      throw error;
    }
    // Hostile objects (getters, proxies) can throw anything while being read.
    throw new RecipeError("", "the recipe could not be read");
  }
}
