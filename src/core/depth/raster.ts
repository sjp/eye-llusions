import type { DrawingLayer, ImageLayer, Recipe, SampleLayer, TextLayer } from "../recipe.ts";

/**
 * One layer rasterised at the output resolution, row-major. `depth` runs from 0 (far)
 * to 1 (near) before the layer's strength is applied; `coverage` is the layer's alpha
 * from 0 to 1, fractional along anti-aliased edges.
 */
export type LayerField = {
  depth: Float32Array;
  coverage: Float32Array;
};

export type RasterContext = {
  recipe: Recipe;
  width: number;
  height: number;
  /** Zero-filled buffers of `width * height` values for the rasteriser to fill in. */
  target: LayerField;
};

/** Columns `x0` up to `x1` of rows `y0` up to `y1`, each end exclusive. */
export type RasterBounds = { x0: number; y0: number; x1: number; y1: number };

/**
 * Fills `context.target` for a layer. Rasterisers that need fonts or a canvas may be
 * async. One that returns bounds has written nothing outside them, so the compositor
 * can skip the rest of the canvas.
 */
export type Rasteriser<L> = (
  layer: L,
  context: RasterContext,
) => RasterBounds | undefined | Promise<RasterBounds | undefined>;

/**
 * Rasterisers by layer kind. Layers whose kind has none are skipped, so environments
 * such as a worker can add kinds that need canvas or font APIs.
 */
export type RasteriserRegistry = {
  sample?: Rasteriser<SampleLayer>;
  text?: Rasteriser<TextLayer>;
  drawing?: Rasteriser<DrawingLayer>;
  image?: Rasteriser<ImageLayer>;
};
