import { describe, expect, test, vi } from "vitest";
import { writeChunks } from "../core/png/chunks.ts";
import { defaultRecipe, type Recipe } from "../core/recipe.ts";
import { ProjectFileError } from "./projectFile.ts";
import {
  embedProjectOffThread,
  handleProjectRequest,
  readProjectOffThread,
  type ProjectRequest,
} from "./projectFileWorker.ts";

function tinyPng(): Uint8Array<ArrayBuffer> {
  const header = Uint8Array.of(0, 0, 0, 2, 0, 0, 0, 1, 8, 2, 0, 0, 0);
  return writeChunks([
    { type: "IHDR", data: header },
    { type: "IDAT", data: Uint8Array.of(120, 156, 99, 248, 207, 0, 4, 255, 1, 7, 0, 1, 255) },
    { type: "IEND", data: new Uint8Array() },
  ]);
}

function recipe(): Recipe {
  const base = defaultRecipe();
  return {
    ...base,
    texture: {
      ...base.texture,
      generator: { type: "tile", asset: "tile", divisions: 1, jitter: 0 },
    },
    assets: { tile: { format: "gray", width: 2, height: 2, data: Uint8Array.of(1, 2, 3, 4) } },
  };
}

/** Answers each request as the worker would, after a turn of the event loop. */
class FakeWorker extends EventTarget {
  readonly transfers: Transferable[][] = [];
  terminate = vi.fn<() => void>();
  respond = true;

  postMessage(request: ProjectRequest, { transfer }: StructuredSerializeOptions): void {
    this.transfers.push(transfer ?? []);
    if (!this.respond) {
      return;
    }
    void this.#answer(request);
  }

  async #answer(request: ProjectRequest): Promise<void> {
    const { response } = await handleProjectRequest(request);
    this.dispatchEvent(new MessageEvent("message", { data: response }));
  }
}

function fake(): { worker: FakeWorker; createWorker: () => Worker } {
  const worker = new FakeWorker();
  return { worker, createWorker: () => worker as unknown as Worker };
}

describe("project files off the main thread", () => {
  test("embed and read in a worker, handing over the file bytes, then stop it", async () => {
    const embedding = fake();
    const png = tinyPng();
    const file = await embedProjectOffThread(png, recipe(), embedding);
    expect(embedding.worker.transfers).toEqual([[png.buffer]]);
    expect(embedding.worker.terminate).toHaveBeenCalledOnce();
    const reading = fake();
    expect(await readProjectOffThread(file, reading)).toEqual(recipe());
    expect(reading.worker.terminate).toHaveBeenCalledOnce();
  });

  test("run here without worker support", async () => {
    const file = await embedProjectOffThread(tinyPng(), recipe(), {
      createWorker: () => undefined,
    });
    const read = await readProjectOffThread(file, { createWorker: () => undefined });
    expect(read).toEqual(recipe());
  });

  test("reject with the same problems as reading in place", async () => {
    const error: unknown = await readProjectOffThread(tinyPng(), fake()).catch(
      (reason: unknown) => reason,
    );
    expect(error).toBeInstanceOf(ProjectFileError);
    expect(error).toMatchObject({ kind: "none" });
  });

  test("stop the worker when aborted", async () => {
    const { worker, createWorker } = fake();
    worker.respond = false;
    const aborter = new AbortController();
    const embedding = embedProjectOffThread(tinyPng(), recipe(), {
      signal: aborter.signal,
      createWorker,
    });
    aborter.abort();
    await expect(embedding).rejects.toMatchObject({ name: "AbortError" });
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  test("reject when the worker fails", async () => {
    const { worker, createWorker } = fake();
    worker.respond = false;
    const reading = readProjectOffThread(tinyPng(), { createWorker });
    worker.dispatchEvent(new Event("error"));
    await expect(reading).rejects.toThrow(Error);
    expect(worker.terminate).toHaveBeenCalledOnce();
  });
});
