import type { FigureId } from "../../core/depth/figure.ts";
import {
  defaultRecipe,
  type Point,
  type Recipe,
  type SampleLayer,
  type SampleShape,
  type TextLayer,
  type TextureSpec,
} from "../../core/recipe.ts";

export type GallerySample = { id: string; title: string; recipe: Recipe };

type Placement = { center: Point; size: number; depth?: number; name?: string };

function shape(id: string, sampleShape: SampleShape, placement: Placement): SampleLayer {
  return {
    kind: "sample",
    id,
    name: placement.name ?? id[0].toUpperCase() + id.slice(1).replaceAll("-", " "),
    visible: true,
    blend: "max",
    depth: placement.depth ?? 1,
    shape: sampleShape,
    center: placement.center,
    size: placement.size,
  };
}

function figure(id: string, which: FigureId, placement: Placement): SampleLayer {
  return shape(id, { type: "figure", figure: which }, placement);
}

function text(id: string, words: string, font: string, placement: Placement): TextLayer {
  return {
    kind: "text",
    id,
    name: placement.name ?? words,
    visible: true,
    blend: "max",
    depth: placement.depth ?? 1,
    text: words,
    font,
    size: placement.size,
    center: placement.center,
    edge: "round",
    edgeWidth: 0.03,
  };
}

function texture(
  generator: TextureSpec["generator"],
  palette: TextureSpec["palette"] | string,
  scale = 1,
): TextureSpec {
  return {
    generator,
    palette: typeof palette === "string" ? { type: "preset", id: palette } : palette,
    scale,
    seed: 0,
  };
}

function scene(
  seed: number,
  layers: Recipe["layers"],
  textureSpec: TextureSpec,
  view: Partial<Recipe["view"]> = {},
): Recipe {
  const base = defaultRecipe();
  return {
    ...base,
    seed,
    layers,
    texture: textureSpec,
    view: { ...base.view, ...view },
    assets: {},
  };
}

/** The ready-made scenes on the first screen, each a complete recipe to view or remix. */
export const GALLERY: readonly GallerySample[] = [
  {
    id: "heart",
    title: "Heart",
    recipe: scene(
      0x4ea7_0001,
      [figure("heart", "heart", { center: { x: 0.5, y: 0.5 }, size: 0.9 })],
      texture({ type: "fractalNoise", octaves: 4 }, "pastel"),
    ),
  },
  {
    id: "hello",
    title: "Hello",
    recipe: scene(
      0x4ea7_0002,
      [text("hello", "HELLO", "anton", { center: { x: 0.5, y: 0.5 }, size: 0.5 })],
      texture({ type: "randomDots", density: 0.5 }, "mono"),
    ),
  },
  {
    id: "lift-off",
    title: "Lift-off",
    recipe: scene(
      0x4ea7_0003,
      [
        shape("moon", { type: "sphere" }, { center: { x: 0.2, y: 0.28 }, size: 0.3, depth: 0.4 }),
        figure("rocket", "rocket", { center: { x: 0.55, y: 0.5 }, size: 0.95 }),
        shape(
          "planet",
          { type: "torus", thickness: 0.5 },
          {
            center: { x: 0.84, y: 0.74 },
            size: 0.3,
            depth: 0.55,
          },
        ),
      ],
      texture({ type: "cells", shading: 0.6 }, "neon"),
    ),
  },
  {
    id: "teatime",
    title: "Teatime",
    recipe: scene(
      0x4ea7_0004,
      [
        figure("teapot", "teapot", { center: { x: 0.42, y: 0.52 }, size: 0.9 }),
        text("tea", "TEA", "alfa-slab-one", {
          center: { x: 0.8, y: 0.3 },
          size: 0.2,
          depth: 0.6,
        }),
      ],
      texture({ type: "fractalNoise", octaves: 5 }, "autumn"),
    ),
  },
  {
    id: "school-of-fish",
    title: "School of fish",
    recipe: scene(
      0x4ea7_0005,
      [
        shape(
          "waves",
          { type: "ripples", rings: 7 },
          {
            center: { x: 0.5, y: 0.5 },
            size: 2,
            depth: 0.25,
          },
        ),
        figure("fish-far", "fish", { center: { x: 0.75, y: 0.27 }, size: 0.35, depth: 0.55 }),
        figure("fish-middle", "fish", { center: { x: 0.24, y: 0.7 }, size: 0.45, depth: 0.75 }),
        figure("fish-near", "fish", { center: { x: 0.55, y: 0.52 }, size: 0.7 }),
      ],
      texture({ type: "fractalNoise", octaves: 3 }, "ocean"),
    ),
  },
  {
    id: "checkmate",
    title: "Checkmate",
    recipe: scene(
      0x4ea7_0006,
      [
        figure("knight", "knight", { center: { x: 0.36, y: 0.5 }, size: 0.95 }),
        shape(
          "pyramid",
          { type: "pyramid", sides: 4 },
          {
            center: { x: 0.74, y: 0.62 },
            size: 0.45,
            depth: 0.6,
          },
        ),
      ],
      texture({ type: "scatteredShapes", density: 0.5 }, "mono"),
    ),
  },
  {
    id: "cat-nap",
    title: "Cat nap",
    recipe: scene(
      0x4ea7_0007,
      [
        figure("cat", "cat", { center: { x: 0.34, y: 0.52 }, size: 0.88 }),
        text("purr", "purr", "archivo-black", {
          center: { x: 0.75, y: 0.62 },
          size: 0.2,
          depth: 0.55,
        }),
      ],
      texture({ type: "cells", shading: 0.3 }, "forest"),
    ),
  },
  {
    id: "butterflies",
    title: "Butterflies",
    recipe: scene(
      0x4ea7_0008,
      [
        figure("butterfly-far", "butterfly", {
          center: { x: 0.74, y: 0.32 },
          size: 0.45,
          depth: 0.6,
        }),
        figure("butterfly-near", "butterfly", { center: { x: 0.38, y: 0.55 }, size: 0.75 }),
      ],
      texture({ type: "scatteredShapes", density: 0.7 }, "pastel"),
    ),
  },
  {
    id: "starry-night",
    title: "Starry night",
    recipe: scene(
      0x4ea7_0009,
      [
        figure("star-left", "star", { center: { x: 0.15, y: 0.3 }, size: 0.3, depth: 0.45 }),
        figure("star-right", "star", { center: { x: 0.85, y: 0.68 }, size: 0.34, depth: 0.55 }),
        figure("star", "star", { center: { x: 0.5, y: 0.5 }, size: 0.85 }),
      ],
      texture(
        { type: "colourNoise" },
        { type: "custom", stops: ["#0b1d51", "#3f51b5", "#ffd54f"] },
      ),
    ),
  },
  {
    id: "ring-and-ripples",
    title: "Ring and ripples",
    recipe: scene(
      0x4ea7_000a,
      [
        shape(
          "ring",
          { type: "torus", thickness: 0.45 },
          { center: { x: 0.3, y: 0.5 }, size: 0.8 },
        ),
        shape("ripples", { type: "ripples", rings: 5 }, { center: { x: 0.73, y: 0.5 }, size: 0.7 }),
      ],
      texture({ type: "cells", shading: 0.5 }, "ocean"),
      { repeats: 9 },
    ),
  },
  {
    id: "spiral-stairs",
    title: "Spiral stairs",
    recipe: scene(
      0x4ea7_000b,
      [
        shape(
          "stairs",
          { type: "spiralStairs", steps: 24, turns: 2 },
          {
            center: { x: 0.5, y: 0.5 },
            size: 0.95,
          },
        ),
      ],
      texture({ type: "fractalNoise", octaves: 4 }, "forest"),
    ),
  },
];
