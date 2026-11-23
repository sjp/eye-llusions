import type { Asset, Recipe } from "../core/recipe.ts";

export type RenderOutput = "stereogram" | "depth";

export type RenderRequest = {
  type: "render";
  requestId: number;
  /** Sent without its assets, which travel in `assets` only when the worker lacks them. */
  recipe: Recipe;
  width: number;
  height: number;
  oversample: number;
  output: RenderOutput;
  /** Assets the worker hasn't cached yet. */
  assets: Record<string, Asset>;
  /** Every asset ID the recipe holds. The worker forgets cached assets not listed. */
  assetIds: string[];
};

/**
 * Drops the request with this ID, and any older one, at its next pause. The worker
 * still replies to it, with an error.
 */
export type CancelRequest = { type: "cancel"; requestId: number };

export type WorkerMessage = RenderRequest | CancelRequest;

export type RenderResponse =
  | { requestId: number; ok: true; image: ImageBitmap | ImageData }
  | { requestId: number; ok: false; message: string };
