import type { Page } from "@playwright/test";
import type { Asset } from "../src/core/recipe.ts";
import type { RenderOutput } from "../src/render/protocol.ts";

/** The absolute URL of the app's render worker, found through the page's own script. */
export async function workerUrl(page: Page): Promise<string> {
  const html = await (await page.request.get("./")).text();
  const src = /<script[^>]+src="([^"]+)"/.exec(html)?.[1];
  if (src === undefined) {
    throw new Error("The page has no script");
  }
  const script = new URL(src, page.url());
  const code = await (await page.request.get(script.href)).text();
  const worker = /worker-[\w-]+\.js/.exec(code)?.[0];
  if (worker === undefined) {
    throw new Error("The script names no render worker");
  }
  return new URL(worker, script).href;
}

type Render = {
  /** A recipe, with its assets. */
  recipe: { assets: Record<string, Asset> };
  width: number;
  height: number;
  oversample: number;
  output: RenderOutput;
};

/**
 * Renders in a fresh copy of the app's worker on the page, which must have the app open,
 * and returns the RGBA pixels.
 */
export async function renderInWorker(page: Page, url: string, render: Render): Promise<number[]> {
  return page.evaluate(
    async ([script, { recipe, ...rest }]) => {
      const worker = new Worker(script, { type: "module" });
      const assets: Record<string, Asset> = recipe.assets;
      const reply = await new Promise<MessageEvent>((resolve, reject) => {
        worker.addEventListener("message", resolve);
        worker.addEventListener("error", () => {
          reject(new Error("worker failed"));
        });
        worker.postMessage(
          {
            type: "render",
            requestId: 1,
            recipe: { ...recipe, assets: {} },
            ...rest,
            assets,
            assetIds: Object.keys(assets),
          },
          [],
        );
      });
      worker.terminate();
      const response: unknown = reply.data;
      if (typeof response !== "object" || response === null || !("image" in response)) {
        throw new Error(JSON.stringify(response));
      }
      const image = response.image;
      const context = new OffscreenCanvas(rest.width, rest.height).getContext("2d");
      if (context === null) {
        throw new Error("No 2D context");
      }
      if (image instanceof ImageData) {
        context.putImageData(image, 0, 0);
      } else if (image instanceof ImageBitmap) {
        context.drawImage(image, 0, 0);
      }
      return Array.from(context.getImageData(0, 0, rest.width, rest.height).data);
    },
    [url, render] as const,
  );
}
