import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { defaultRecipe } from "../core/recipe.ts";
import { renderPixels } from "./pipeline.ts";
import type { RenderRequest, RenderResponse, WorkerMessage } from "./protocol.ts";

vi.mock(import("./pipeline.ts"), async (importOriginal) => ({
  ...(await importOriginal()),
  renderPixels: vi.fn<typeof renderPixels>(),
}));

class FakeImageData {
  readonly data: Uint8ClampedArray<ArrayBuffer>;

  constructor(data: Uint8ClampedArray<ArrayBuffer>) {
    this.data = data;
  }
}

class FakeBitmap {
  readonly kind = "bitmap";
}

type Posted = { response: RenderResponse; transfer: Transferable[] };

let posted: Posted[];
let onMessage: ((event: MessageEvent<WorkerMessage>) => void) | undefined;
const render = vi.mocked(renderPixels);
const createBitmap = vi.fn<(data: FakeImageData, options: object) => Promise<FakeBitmap>>();

/** Loads a fresh copy of the worker, listening through the stubbed globals. */
async function startWorker(): Promise<void> {
  vi.resetModules();
  await import("./worker.ts");
}

function request(requestId: number, width = 4, height = 2): RenderRequest {
  return {
    type: "render",
    requestId,
    recipe: defaultRecipe(),
    width,
    height,
    oversample: 1,
    output: "stereogram",
    assets: {},
    assetIds: [],
  };
}

async function send(message: WorkerMessage): Promise<Posted> {
  const count = posted.length;
  onMessage?.(new MessageEvent("message", { data: message }));
  await vi.waitFor(() => {
    expect(posted.length).toBeGreaterThan(count);
  });
  return posted[count];
}

/** The buffer the pipeline was given to reuse on its last call. */
function lastTarget() {
  return render.mock.lastCall?.[3];
}

beforeEach(() => {
  vi.useRealTimers();
  posted = [];
  onMessage = undefined;
  render.mockReset();
  render.mockImplementation((_recipe, { width, height }, _rasterisers, target) =>
    Promise.resolve(target ?? new Uint8ClampedArray(width * height * 4)),
  );
  createBitmap.mockReset();
  createBitmap.mockImplementation(() => Promise.resolve(new FakeBitmap()));
  vi.stubGlobal("ImageData", FakeImageData);
  vi.stubGlobal("createImageBitmap", createBitmap);
  vi.stubGlobal(
    "postMessage",
    (response: RenderResponse, { transfer }: StructuredSerializeOptions) => {
      posted.push({ response, transfer: transfer ?? [] });
    },
  );
  vi.stubGlobal("addEventListener", (type: string, listener: typeof onMessage) => {
    if (type === "message") {
      onMessage = listener;
    }
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the render worker", () => {
  test("replies with a bitmap it transfers, made without colour conversion", async () => {
    await startWorker();
    const { response, transfer } = await send(request(1));
    expect(response.ok).toBe(true);
    const image = response.ok ? response.image : undefined;
    expect(image).toBeInstanceOf(FakeBitmap);
    expect(transfer).toEqual([image]);
    expect(createBitmap).toHaveBeenCalledWith(expect.any(FakeImageData), {
      premultiplyAlpha: "none",
      colorSpaceConversion: "none",
    });
  });

  test("reuses a pixel buffer of the right size while results go out as bitmaps", async () => {
    await startWorker();
    await send(request(1));
    expect(lastTarget()).toBeUndefined();
    const first: unknown = await render.mock.results[0].value;
    await send(request(2));
    expect(lastTarget()).toBe(first);

    // A draft size gets a buffer of its own, and the full size's is still kept.
    await send(request(3, 2, 1));
    expect(lastTarget()).toBeUndefined();
    const draft: unknown = await render.mock.results[2].value;
    await send(request(4, 2, 1));
    expect(lastTarget()).toBe(draft);
    await send(request(5));
    expect(lastTarget()).toBe(first);
  });

  test("keeps only the two most recent buffers", async () => {
    await startWorker();
    await send(request(1, 1, 1));
    await send(request(2, 2, 1));
    await send(request(3, 3, 1));
    await send(request(4, 1, 1));
    expect(lastTarget()).toBeUndefined();
  });

  test("falls back to transferring ImageData when a bitmap can't be made", async () => {
    createBitmap.mockRejectedValue(new Error("unsupported"));
    await startWorker();
    const { response, transfer } = await send(request(1));
    const image = response.ok ? response.image : undefined;
    expect(image).toBeInstanceOf(FakeImageData);
    expect(transfer).toEqual([(image as unknown as FakeImageData).data.buffer]);

    // The transferred buffer is gone, so it isn't offered for reuse.
    await send(request(2));
    expect(lastTarget()).toBeUndefined();
  });

  test("falls back to ImageData where createImageBitmap doesn't exist", async () => {
    vi.stubGlobal("createImageBitmap", undefined);
    await startWorker();
    const { response } = await send(request(1));
    expect(response.ok && response.image).toBeInstanceOf(FakeImageData);
  });

  test("replies to a failed render with its error and renders the next one", async () => {
    await startWorker();
    render.mockRejectedValueOnce(new Error("out of memory"));
    expect((await send(request(1))).response).toEqual({
      requestId: 1,
      ok: false,
      message: "out of memory",
    });
    expect((await send(request(2))).response).toMatchObject({ requestId: 2, ok: true });
  });

  test("answers requests in order, dropping one a newer request supersedes", async () => {
    await startWorker();
    let release = (): void => {};
    render.mockImplementationOnce(
      async (_recipe, { width, height }, _rasterisers, _target, pause) => {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        await pause?.();
        return new Uint8ClampedArray(width * height * 4);
      },
    );
    onMessage?.(new MessageEvent("message", { data: request(1) }));
    onMessage?.(new MessageEvent("message", { data: request(2) }));
    await vi.waitFor(() => {
      expect(render).toHaveBeenCalledTimes(1);
    });
    release();
    await vi.waitFor(() => {
      expect(posted).toHaveLength(2);
    });
    expect(posted.map(({ response }) => [response.requestId, response.ok])).toEqual([
      [1, false],
      [2, true],
    ]);
  });
});
