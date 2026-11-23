import type { Recipe } from "../core/recipe.ts";
import { RenderClient, type RenderImage } from "../render/client.ts";
import { EXPORT_OVERSAMPLE } from "../render/resolution.ts";
import { embedProjectOffThread } from "../state/projectFileWorker.ts";

type Size = { width: number; height: number };

/**
 * Renders the recipe at `size` into a PNG file that holds the whole project. Aborting
 * `signal` stops the work and rejects.
 */
export type ExportPng = (recipe: Recipe, size: Size, signal?: AbortSignal) => Promise<Blob>;

async function encodePng(image: RenderImage): Promise<Blob> {
  const { width, height } = image;
  const draw = (context: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D): void => {
    if (image instanceof ImageData) {
      context.putImageData(image, 0, 0);
    } else {
      context.drawImage(image, 0, 0);
    }
  };
  if (typeof OffscreenCanvas === "function") {
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext("2d");
    if (context !== null) {
      draw(context);
      return canvas.convertToBlob({ type: "image/png" });
    }
  }
  const canvas = Object.assign(document.createElement("canvas"), { width, height });
  const context = canvas.getContext("2d");
  if (context === null) {
    throw new Error("No 2D canvas");
  }
  draw(context);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob === null) {
        reject(new Error("The canvas couldn't be encoded"));
      } else {
        resolve(blob);
      }
    }, "image/png");
  });
}

/**
 * Renders in a worker of its own, so the preview's renders can't cancel the export,
 * and stops the worker as soon as the picture is back or the export is aborted.
 */
export const renderPng: ExportPng = async (recipe, size, signal) => {
  signal?.throwIfAborted();
  const client = new RenderClient();
  const stop = (): void => {
    client.dispose();
  };
  signal?.addEventListener("abort", stop);
  let image: RenderImage;
  try {
    image = await client.render(recipe, size, { oversample: EXPORT_OVERSAMPLE });
  } finally {
    signal?.removeEventListener("abort", stop);
    client.dispose();
  }
  try {
    signal?.throwIfAborted();
    const png = new Uint8Array(await (await encodePng(image)).arrayBuffer());
    signal?.throwIfAborted();
    const file = await embedProjectOffThread(png, recipe, signal === undefined ? {} : { signal });
    const blob = new Blob([file], { type: "image/png" });
    signal?.throwIfAborted();
    return blob;
  } finally {
    if (!(image instanceof ImageData)) {
      image.close();
    }
  }
};

/** Downloads the blob through a temporary blob: link, revoked once the download starts. */
export function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const link = Object.assign(document.createElement("a"), { href: url, download: name });
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 60_000);
}
