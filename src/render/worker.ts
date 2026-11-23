import { CORE_RASTERISERS } from "../core/depth/composite.ts";
import type { Asset } from "../core/recipe.ts";
import type { RasteriserRegistry } from "../core/depth/raster.ts";
import { createSampleRasteriser } from "./figures.ts";
import { createDepthCache, renderPixels, restoreAssets } from "./pipeline.ts";
import type { WorkerMessage } from "./protocol.ts";
import { createRenderQueue } from "./queue.ts";
import { createTextRasteriser } from "./text.ts";

const rasterisers: RasteriserRegistry = {
  ...CORE_RASTERISERS,
  sample: createSampleRasteriser(),
  text: createTextRasteriser(),
};

const assets = new Map<string, Asset>();
const depthCache = createDepthCache();
/** Reused while results go out as bitmaps, which copy it; ImageData results take it. */
let buffer: Uint8ClampedArray<ArrayBuffer> | undefined;

async function toImage(
  pixels: Uint8ClampedArray<ArrayBuffer>,
  width: number,
  height: number,
): Promise<ImageBitmap | ImageData> {
  const data = new ImageData(pixels, width, height);
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(data, {
        premultiplyAlpha: "none",
        colorSpaceConversion: "none",
      });
      buffer = pixels;
      return bitmap;
    } catch {
      // Fall back to ImageData below.
    }
  }
  buffer = undefined;
  return data;
}

const enqueue = createRenderQueue(
  async (request, pause) => {
    const { recipe, changed } = restoreAssets(assets, request);
    if (changed) {
      depthCache.assetsChanged();
    }
    const pixels = await renderPixels(
      recipe,
      request,
      rasterisers,
      buffer,
      pause,
      depthCache.composite,
    );
    const image = await toImage(pixels, request.width, request.height);
    return { image, transfer: [image instanceof ImageData ? image.data.buffer : image] };
  },
  (response, transfer) => {
    postMessage(response, { transfer });
  },
);

addEventListener("message", (event: MessageEvent<WorkerMessage>) => {
  void enqueue(event.data);
});
