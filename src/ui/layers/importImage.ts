import { downscaleSize, luminance } from "../../core/depth/image.ts";
import type { Asset } from "../../core/recipe.ts";

/** Longest side of a stored image, in pixels, by default. */
const MAX_SIDE = 1024;
const MAX_FILE_BYTES = 40 * 1024 * 1024;
const MAX_DECODED_SIDE = 16_384;

/** A problem with a chosen file, with a message to show as is. */
export class ImageImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImageImportError";
  }
}

function canvas2d(width: number, height: number) {
  const context =
    typeof OffscreenCanvas === "function"
      ? new OffscreenCanvas(width, height).getContext("2d", { willReadFrequently: true })
      : Object.assign(document.createElement("canvas"), { width, height }).getContext("2d", {
          willReadFrequently: true,
        });
  if (context === null) {
    throw new ImageImportError("This browser couldn't process the image.");
  }
  return context;
}

/**
 * Decodes an image file into an asset no larger than `maxSide` pixels on its longest
 * side: grey by default, or opaque colour over black. Decoding goes through
 * `createImageBitmap`, never an image element, so it works under a CSP that blocks
 * blob: and data: images.
 */
export async function importImage(
  file: Blob,
  { format = "gray", maxSide = MAX_SIDE }: { format?: Asset["format"]; maxSide?: number } = {},
): Promise<Asset> {
  if (file.type !== "" && !file.type.startsWith("image/")) {
    throw new ImageImportError("That file isn't an image. Choose a PNG, JPEG, WebP or GIF.");
  }
  if (file.size > MAX_FILE_BYTES) {
    throw new ImageImportError("That image is over 40 MB. Choose a smaller one.");
  }
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new ImageImportError("That image couldn't be opened. Choose a PNG, JPEG, WebP or GIF.");
  }
  try {
    if (bitmap.width > MAX_DECODED_SIDE || bitmap.height > MAX_DECODED_SIDE) {
      throw new ImageImportError("That image is too large. Choose a smaller one.");
    }
    const { width, height } = downscaleSize(bitmap.width, bitmap.height, maxSide);
    const context = canvas2d(width, height);
    if (format === "rgba") {
      context.fillStyle = "#000";
      context.fillRect(0, 0, width, height);
    }
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(bitmap, 0, 0, width, height);
    const { data } = context.getImageData(0, 0, width, height);
    return format === "rgba"
      ? { format, width, height, data: new Uint8Array(data.buffer) }
      : { format, width, height, data: luminance(data) };
  } finally {
    bitmap.close();
  }
}
