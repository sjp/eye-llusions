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

/** Fills `context.target` for a layer. Rasterisers that need fonts or a canvas may be async. */
export type Rasteriser<L> = (layer: L, context: RasterContext) => void | Promise<void>;

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
