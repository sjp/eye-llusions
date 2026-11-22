import { CORE_RASTERISERS } from "../core/depth/composite.ts";
import type { Asset } from "../core/recipe.ts";
import type { RasteriserRegistry } from "../core/depth/raster.ts";
import { renderPixels, restoreAssets } from "./pipeline.ts";
import type { RenderRequest, RenderResponse } from "./protocol.ts";
import { createTextRasteriser } from "./text.ts";

const rasterisers: RasteriserRegistry = { ...CORE_RASTERISERS, text: createTextRasteriser() };

const assets = new Map<string, Asset>();
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

async function handle(request: RenderRequest): Promise<void> {
  let response: RenderResponse;
  let transfer: Transferable[] = [];
  try {
    const recipe = restoreAssets(assets, request);
    const pixels = await renderPixels(recipe, request, rasterisers, buffer);
    const image = await toImage(pixels, request.width, request.height);
    response = { requestId: request.requestId, ok: true, image };
    transfer = [image instanceof ImageData ? image.data.buffer : image];
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    response = { requestId: request.requestId, ok: false, message };
  }
  postMessage(response, { transfer });
}

let queue = Promise.resolve();

addEventListener("message", (event: MessageEvent<RenderRequest>) => {
  const request = event.data;
  queue = queue.then(() => handle(request));
});
