// Loaded by e2e/render.html in the browser tests: exposes the render client on window.
import { defaultRecipe } from "../src/core/recipe.ts";
import { isRenderAborted, RenderClient, type RenderImage } from "../src/render/client.ts";

type RenderSummary = {
  kind: "ImageBitmap" | "ImageData";
  width: number;
  height: number;
  colours: number;
};

type BurstSummary = {
  fulfilled: number[];
  aborted: number;
  otherErrors: string[];
  pending: number;
};

declare global {
  interface Window {
    renderHarness: {
      render: (output: "stereogram" | "depth") => Promise<RenderSummary>;
      burst: (count: number) => Promise<BurstSummary>;
    };
  }
}

const client = new RenderClient();
const SIZE = { width: 320, height: 180 };

function summarise(image: RenderImage): RenderSummary {
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  const context = canvas.getContext("2d");
  if (context === null) {
    throw new Error("No 2D context");
  }
  if (image instanceof ImageData) {
    context.putImageData(image, 0, 0);
  } else {
    context.drawImage(image, 0, 0);
    image.close();
  }
  const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
  const colours = new Set<number>();
  for (let i = 0; i < data.length; i += 4) {
    colours.add((data[i] << 16) | (data[i + 1] << 8) | data[i + 2]);
  }
  return {
    kind: image instanceof ImageData ? "ImageData" : "ImageBitmap",
    width: canvas.width,
    height: canvas.height,
    colours: colours.size,
  };
}

window.renderHarness = {
  render: async (output) => summarise(await client.render(defaultRecipe(), SIZE, { output })),
  burst: async (count) => {
    const results = Array.from({ length: count }, (_, i) =>
      client.render({ ...defaultRecipe(), seed: i }, SIZE),
    );
    const outcomes = await Promise.allSettled(results);
    const summary: BurstSummary = { fulfilled: [], aborted: 0, otherErrors: [], pending: 0 };
    for (const [i, outcome] of outcomes.entries()) {
      if (outcome.status === "fulfilled") {
        summary.fulfilled.push(i);
        summarise(outcome.value);
      } else if (isRenderAborted(outcome.reason)) {
        summary.aborted++;
      } else {
        summary.otherErrors.push(String(outcome.reason));
      }
    }
    summary.pending = client.pending;
    return summary;
  },
};
