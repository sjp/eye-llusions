/**
 * A Recipe is the complete, serialisable description of a stereogram. Geometry uses
 * normalised canvas coordinates: x and y run from 0 to 1 across the width and height,
 * and sizes are fractions of the canvas height.
 */

export const RECIPE_VERSION = 1;

export type Recipe = {
  version: typeof RECIPE_VERSION;
  /** Width divided by height. */
  aspect: number;
  /** Unsigned 32-bit integer from which every random choice is derived. */
  seed: number;
  /** Bottom to top. */
  layers: Layer[];
  texture: TextureSpec;
  view: ViewSettings;
  /** Binary data referenced by ID from layers and the texture. */
  assets: Record<string, Asset>;
};

type ViewSettings = {
  /** Pattern repeats across the image width at the far plane. */
  repeats: number;
  /** Depth range as a fraction of the far-plane strip width. */
  depthOfField: number;
  mode: "wall" | "cross";
};

export type Point = { x: number; y: number };

type BlendMode = "max" | "add" | "subtract" | "replace";

type LayerCommon = {
  id: string;
  name: string;
  visible: boolean;
  blend: BlendMode;
  /** Strength of this layer's depth, from 0 to 1. */
  depth: number;
};

export type SampleShape =
  | { type: "sphere" }
  | { type: "ripples"; rings: number }
  | { type: "pyramid"; sides: number }
  | { type: "torus"; thickness: number }
  | { type: "spiralStairs"; steps: number; turns: number };

export type SampleLayer = LayerCommon & {
  kind: "sample";
  shape: SampleShape;
  center: Point;
  /** Diameter, as a fraction of the canvas height. */
  size: number;
};

type EdgeProfile = "flat" | "bevel" | "round";

export type TextLayer = LayerCommon & {
  kind: "text";
  text: string;
  font: string;
  /** Line height, as a fraction of the canvas height. */
  size: number;
  center: Point;
  edge: EdgeProfile;
  /** Width of the bevelled or rounded edge, as a fraction of the canvas height. */
  edgeWidth: number;
};

type BrushMode = "set" | "raise" | "lower" | "smooth";

export type Brush = {
  /** Diameter, as a fraction of the canvas height. */
  size: number;
  /** 0 for a hard edge, 1 for the softest falloff. */
  softness: number;
  mode: BrushMode;
  /** Target depth for `set`, or amount for `raise` and `lower`. */
  value: number;
};

export type Stroke = {
  brush: Brush;
  /** Flattened coordinates: x0, y0, x1, y1, … */
  points: number[];
};

export type DrawingLayer = LayerCommon & {
  kind: "drawing";
  strokes: Stroke[];
};

type ImageFit = "contain" | "cover" | "stretch";

export type ImageLayer = LayerCommon & {
  kind: "image";
  asset: string;
  fit: ImageFit;
  invert: boolean;
  /** Input values mapped to 0 and 1; black is below white. */
  levels: { black: number; white: number };
  /** Blur radius, as a fraction of the canvas height. */
  blur: number;
  /** Number of depth levels, or null for continuous depth. */
  posterize: number | null;
  /** Depth cut-off for a two-level silhouette, or null for none. */
  threshold: number | null;
};

export type Layer = SampleLayer | TextLayer | DrawingLayer | ImageLayer;

export type TextureGenerator =
  | { type: "randomDots"; density: number }
  | { type: "colourNoise" }
  /** Organic, marble-like noise; `octaves` adds ever finer detail. */
  | { type: "fractalNoise"; octaves: number }
  /** Voronoi cells, darkened towards their borders by `shading`. */
  | { type: "cells"; shading: number }
  /** Small glyphs over a noise background; `density` is the chance of a glyph per spot. */
  | { type: "scatteredShapes"; density: number };

export type Palette =
  | { type: "preset"; id: string }
  /** Colours as `#rrggbb`. */
  | { type: "custom"; stops: string[] };

export type TextureSpec = {
  generator: TextureGenerator;
  palette: Palette;
  /** Multiplier on the generator's base feature size. */
  scale: number;
};

type AssetFormat = "gray" | "rgba";

export type Asset = {
  format: AssetFormat;
  width: number;
  height: number;
  /** Row-major pixels: one byte per pixel for gray, four for rgba. */
  data: Uint8Array<ArrayBuffer>;
};

export function defaultRecipe(): Recipe {
  return {
    version: RECIPE_VERSION,
    aspect: 16 / 9,
    seed: 0x5eed_1e55,
    layers: [
      {
        kind: "sample",
        id: "sphere",
        name: "Sphere",
        visible: true,
        blend: "max",
        depth: 1,
        shape: { type: "sphere" },
        center: { x: 0.5, y: 0.5 },
        size: 0.6,
      },
    ],
    texture: {
      generator: { type: "randomDots", density: 0.5 },
      palette: { type: "preset", id: "mono" },
      scale: 1,
    },
    view: { repeats: 8, depthOfField: 1 / 3, mode: "wall" },
    assets: {},
  };
}
