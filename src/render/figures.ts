import {
  prepareFigure,
  rasteriseFigure,
  type FigureId,
  type FigureImage,
} from "../core/depth/figure.ts";
import type { Rasteriser } from "../core/depth/raster.ts";
import { rasteriseSample } from "../core/depth/sample.ts";
import type { SampleLayer } from "../core/recipe.ts";

const URLS = import.meta.glob<string>("../assets/figures/*.png", {
  query: "?url",
  import: "default",
  eager: true,
});

/** The same-origin address of a figure's depth picture. */
export function figureUrl(id: FigureId): string {
  const path = `../assets/figures/${id}.png`;
  if (!Object.hasOwn(URLS, path)) {
    throw new Error(`The ${id} picture is missing`);
  }
  return URLS[path];
}

/** Fetches and decodes a figure; needs `OffscreenCanvas`, as in the render worker. */
async function fetchFigure(id: FigureId): Promise<FigureImage> {
  const response = await fetch(figureUrl(id));
  if (!response.ok) {
    throw new Error(`The ${id} picture couldn't be loaded`);
  }
  const bitmap = await createImageBitmap(await response.blob(), {
    premultiplyAlpha: "none",
    colorSpaceConversion: "none",
  });
  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (context === null || bitmap.width !== bitmap.height) {
      throw new Error(`The ${id} picture couldn't be read`);
    }
    context.drawImage(bitmap, 0, 0);
    const { data } = context.getImageData(0, 0, bitmap.width, bitmap.height);
    return prepareFigure(data, bitmap.width);
  } finally {
    bitmap.close();
  }
}

/**
 * The sample rasteriser extended with figures, whose pictures are loaded on first use
 * and kept. A picture that fails to load is tried again by the next render.
 */
export function createSampleRasteriser(
  load: (id: FigureId) => Promise<FigureImage> = fetchFigure,
): Rasteriser<SampleLayer> {
  const figures = new Map<FigureId, Promise<FigureImage>>();
  return async (layer, context) => {
    if (layer.shape.type !== "figure") {
      return rasteriseSample(layer, context);
    }
    const id = layer.shape.figure;
    let figure = figures.get(id);
    if (figure === undefined) {
      figure = load(id);
      figures.set(id, figure);
      figure.catch(() => {
        figures.delete(id);
      });
    }
    return rasteriseFigure(layer, context, await figure);
  };
}
