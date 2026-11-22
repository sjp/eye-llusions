import type { Asset, Recipe } from "../core/recipe.ts";

export type RenderOutput = "stereogram" | "depth";

export type RenderRequest = {
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

export type RenderResponse =
  | { requestId: number; ok: true; image: ImageBitmap | ImageData }
  | { requestId: number; ok: false; message: string };
