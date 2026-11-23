import { afterEach, describe, expect, test, vi } from "vitest";
import { defaultRecipe } from "../core/recipe.ts";
import { EXPORT_OVERSAMPLE } from "../render/resolution.ts";
import { embedProjectOffThread } from "../state/projectFileWorker.ts";
import { downloadBlob, renderPng } from "./exportPng.ts";

const dispose = vi.fn<() => void>();
const render = vi.fn<(...args: unknown[]) => Promise<unknown>>();

vi.mock(import("../render/client.ts"), async (original) => {
  const actual = await original();
  return {
    ...actual,
    RenderClient: class {
      render = render;
      dispose = dispose;
    } as unknown as typeof actual.RenderClient,
  };
});

vi.mock(import("../state/projectFileWorker.ts"), async (original) => ({
  ...(await original()),
  embedProjectOffThread: vi.fn<typeof embedProjectOffThread>(),
}));

const embed = vi.mocked(embedProjectOffThread);

/** The PNG the stand-in canvases encode to. */
const ENCODED = Uint8Array.of(137, 80, 78, 71);

type Drawn = { put?: ImageData; drawn?: unknown };

/** A 2D context that records what was drawn on it. */
function recordingContext(drawn: Drawn) {
  return {
    putImageData: (image: ImageData) => {
      drawn.put = image;
    },
    drawImage: (image: unknown) => {
      drawn.drawn = image;
    },
  };
}

/** Stands in for OffscreenCanvas, which happy-dom lacks. */
function stubOffscreenCanvas(drawn: Drawn): void {
  vi.stubGlobal(
    "OffscreenCanvas",
    class {
      getContext() {
        return recordingContext(drawn);
      }

      convertToBlob(options: { type: string }) {
        return Promise.resolve(new Blob([ENCODED], options));
      }
    },
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  embed.mockReset();
  render.mockReset();
  dispose.mockReset();
});

describe("renderPng", () => {
  test("encodes the rendered bitmap, embeds the project and closes the bitmap", async () => {
    const drawn: Drawn = {};
    stubOffscreenCanvas(drawn);
    const bitmap = { width: 8, height: 4, close: vi.fn<() => void>() };
    render.mockResolvedValue(bitmap);
    embed.mockImplementation((png) => Promise.resolve(Uint8Array.of(...png, 1)));
    const recipe = defaultRecipe();
    const blob = await renderPng(recipe, { width: 8, height: 4 });
    expect(drawn.drawn).toBe(bitmap);
    expect(embed).toHaveBeenCalledWith(ENCODED, recipe, {});
    expect(blob.type).toBe("image/png");
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(Uint8Array.of(...ENCODED, 1));
    expect(bitmap.close).toHaveBeenCalledOnce();
    expect(dispose).toHaveBeenCalled();
  });

  test("puts ImageData on a page canvas where there's no OffscreenCanvas", async () => {
    vi.stubGlobal("OffscreenCanvas", undefined);
    const drawn: Drawn = {};
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
      recordingContext(drawn) as unknown as CanvasRenderingContext2D,
    );
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((done, type = "") => {
      done(new Blob([ENCODED], { type }));
    });
    const image = new ImageData(2, 2);
    render.mockResolvedValue(image);
    embed.mockImplementation((png) => Promise.resolve(png));
    const blob = await renderPng(defaultRecipe(), { width: 2, height: 2 });
    expect(drawn.put).toBe(image);
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(ENCODED);
  });

  test("rejects when the page canvas can't encode the picture", async () => {
    vi.stubGlobal("OffscreenCanvas", undefined);
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
      recordingContext({}) as unknown as CanvasRenderingContext2D,
    );
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((done) => {
      done(null);
    });
    render.mockResolvedValue(new ImageData(2, 2));
    await expect(renderPng(defaultRecipe(), { width: 2, height: 2 })).rejects.toThrow(
      "couldn't be encoded",
    );
    expect(embed).not.toHaveBeenCalled();
  });

  test("aborting while the project is embedded rejects and still closes the bitmap", async () => {
    stubOffscreenCanvas({});
    const bitmap = { width: 8, height: 4, close: vi.fn<() => void>() };
    render.mockResolvedValue(bitmap);
    const controller = new AbortController();
    embed.mockImplementation((png, _recipe, options) => {
      expect(options?.signal).toBe(controller.signal);
      controller.abort();
      return Promise.resolve(png);
    });
    await expect(
      renderPng(defaultRecipe(), { width: 8, height: 4 }, controller.signal),
    ).rejects.toThrow("aborted");
    expect(bitmap.close).toHaveBeenCalledOnce();
  });

  test("aborting stops the render worker and rejects", async () => {
    let fail: (error: Error) => void = () => undefined;
    render.mockReturnValue(
      new Promise((_resolve, reject) => {
        fail = reject;
      }),
    );
    dispose.mockImplementation(() => {
      fail(new Error("stopped"));
    });
    const controller = new AbortController();
    const result = renderPng(defaultRecipe(), { width: 8, height: 8 }, controller.signal);
    expect(render).toHaveBeenCalledWith(
      expect.anything(),
      { width: 8, height: 8 },
      { oversample: EXPORT_OVERSAMPLE },
    );
    expect(dispose).not.toHaveBeenCalled();
    controller.abort();
    expect(dispose).toHaveBeenCalled();
    await expect(result).rejects.toThrow("stopped");
  });

  test("doesn't start when already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      renderPng(defaultRecipe(), { width: 8, height: 8 }, controller.signal),
    ).rejects.toThrow("aborted");
    expect(render).not.toHaveBeenCalled();
  });
});

describe("downloadBlob", () => {
  test("clicks a temporary link to the blob, revoking it a minute later", () => {
    const createObjectURL = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:png");
    const revokeObjectURL = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    let clicked: { href: string; download: string; connected: boolean } | undefined;
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clicked = { href: this.href, download: this.download, connected: this.isConnected };
    });
    const blob = new Blob([ENCODED], { type: "image/png" });
    downloadBlob(blob, "picture.png");
    expect(createObjectURL).toHaveBeenCalledWith(blob);
    expect(clicked).toEqual({ href: "blob:png", download: "picture.png", connected: true });
    expect(document.querySelector("a")).toBeNull();
    vi.advanceTimersByTime(59_999);
    expect(revokeObjectURL).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:png");
  });
});
