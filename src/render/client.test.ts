import { describe, expect, test, vi } from "vitest";
import { defaultRecipe, type Asset, type Recipe } from "../core/recipe.ts";
import { isRenderAborted, RenderClient, type RenderImage } from "./client.ts";
import type { RenderRequest, RenderResponse } from "./protocol.ts";

class FakeWorker extends EventTarget {
  readonly requests: RenderRequest[] = [];
  readonly images: { close: ReturnType<typeof vi.fn<() => void>> }[] = [];
  terminate = vi.fn<() => void>();

  postMessage(request: RenderRequest): void {
    this.requests.push(request);
  }

  /** Replies to the oldest unanswered request with a fresh fake bitmap. */
  reply(): RenderRequest {
    const request = this.requests.shift();
    if (request === undefined) {
      throw new Error("No request to reply to");
    }
    const image = { width: request.width, height: request.height, close: vi.fn<() => void>() };
    this.images.push(image);
    this.send({ requestId: request.requestId, ok: true, image: image as unknown as ImageBitmap });
    return request;
  }

  send(data: RenderResponse): void {
    this.dispatchEvent(new MessageEvent("message", { data }));
  }
}

/** `worker` is the first worker the client starts; `workers` lists those started so far. */
function setup(): { worker: FakeWorker; workers: FakeWorker[]; client: RenderClient } {
  const worker = new FakeWorker();
  const workers: FakeWorker[] = [];
  const client = new RenderClient(() => {
    const created = workers.length === 0 ? worker : new FakeWorker();
    workers.push(created);
    return created as unknown as Worker;
  });
  return { worker, workers, client };
}

const SIZE = { width: 32, height: 18 };

function withAssets(assets: Record<string, Asset>): Recipe {
  return { ...defaultRecipe(), assets };
}

function asset(value: number): Asset {
  return { format: "gray", width: 1, height: 1, data: new Uint8Array([value]) };
}

describe("RenderClient", () => {
  test("sends the request and resolves with the worker's image", async () => {
    const { worker, client } = setup();
    const result = client.render(defaultRecipe(), SIZE, { output: "depth", oversample: 2 });
    expect(worker.requests[0]).toMatchObject({ ...SIZE, output: "depth", oversample: 2 });
    worker.reply();
    expect(await result).toBe(worker.images[0]);
    expect(client.pending).toBe(0);
  });

  test("rejects with the worker's error message", async () => {
    const { worker, client } = setup();
    const result = client.render(defaultRecipe(), SIZE);
    worker.send({ requestId: worker.requests[0].requestId, ok: false, message: "bad size" });
    await expect(result).rejects.toThrow("bad size");
  });

  test("a burst of 20 requests resolves only the last and leaks nothing", async () => {
    const { worker, client } = setup();
    const results = Array.from({ length: 20 }, (_, i) =>
      client.render({ ...defaultRecipe(), seed: i }, SIZE),
    );
    const settled = Promise.allSettled(results);
    expect(worker.requests).toHaveLength(1);
    worker.reply();
    expect(worker.requests.map((r) => r.recipe.seed)).toEqual([19]);
    worker.reply();

    const outcomes = await settled;
    const rejected = outcomes.slice(0, 19);
    expect(rejected.every((o) => o.status === "rejected" && isRenderAborted(o.reason))).toBe(true);
    const last = outcomes[19];
    expect(last.status).toBe("fulfilled");
    expect(last.status === "fulfilled" ? last.value : undefined).toBe(worker.images[1]);
    expect(worker.images[0].close).toHaveBeenCalledOnce();
    expect(worker.images[1].close).not.toHaveBeenCalled();
    expect(client.pending).toBe(0);
    expect(worker.requests).toHaveLength(0);
  });

  test("rejects the in-flight render as soon as a newer one is requested", async () => {
    const { client } = setup();
    const first = client.render(defaultRecipe(), SIZE);
    const second = client.render(defaultRecipe(), SIZE);
    await expect(first).rejects.toSatisfy(isRenderAborted);
    expect(client.pending).toBe(1);
    second.catch(() => undefined);
  });

  test("sends each asset once and stops tracking removed ones", () => {
    const { worker, client } = setup();
    const a = asset(1);
    const b = asset(2);
    void client.render(withAssets({ a }), SIZE);
    worker.reply();
    void client.render(withAssets({ a, b }), SIZE);
    worker.reply();
    void client.render(withAssets({ b }), SIZE);
    worker.reply();
    void client.render(withAssets({ a, b: asset(3) }), SIZE);
    const sent = worker.requests[0];
    expect(Object.keys(sent.assets).toSorted()).toEqual(["a", "b"]);
    expect(sent.assetIds.toSorted()).toEqual(["a", "b"]);
    expect(sent.recipe.assets).toEqual({});
  });

  test("only sends assets that are new since the last request reached the worker", () => {
    const { worker, client } = setup();
    const a = asset(1);
    const b = asset(2);
    void client.render(withAssets({ a }), SIZE);
    const first = worker.reply();
    void client.render(withAssets({ a, b }), SIZE);
    const second = worker.reply();
    expect(Object.keys(first.assets)).toEqual(["a"]);
    expect(Object.keys(second.assets)).toEqual(["b"]);
    expect(second.assetIds).toEqual(["a", "b"]);
  });

  test("starts the worker on the first render", () => {
    const { workers, client } = setup();
    expect(workers).toHaveLength(0);
    void client.render(defaultRecipe(), SIZE);
    expect(workers).toHaveLength(1);
  });

  test("a worker error rejects pending renders and resends assets afterwards", async () => {
    const { worker, workers, client } = setup();
    const a = asset(1);
    const first = client.render(withAssets({ a }), SIZE);
    worker.dispatchEvent(new Event("error"));
    await expect(first).rejects.toThrow("render worker failed");
    void client.render(withAssets({ a }), SIZE);
    expect(Object.keys(workers[1].requests[0].assets)).toEqual(["a"]);
  });

  test("after a worker error the next render succeeds on a fresh worker", async () => {
    const { workers, client } = setup();
    const first = client.render(defaultRecipe(), SIZE);
    const broken = workers[0];
    broken.dispatchEvent(new ErrorEvent("error", { message: "out of memory" }));
    await expect(first).rejects.toThrow("The render worker failed: out of memory");
    expect(broken.terminate).toHaveBeenCalledOnce();

    const second = client.render(defaultRecipe(), SIZE);
    expect(workers).toHaveLength(2);
    expect(broken.requests).toHaveLength(1);
    workers[1].reply();
    expect(await second).toBe(workers[1].images[0]);
  });

  test("a queued render fails with the worker and the next one restarts it", async () => {
    const { workers, client } = setup();
    const first = client.render(defaultRecipe(), SIZE);
    const queued = client.render(defaultRecipe(), SIZE);
    workers[0].dispatchEvent(new Event("error"));
    await expect(first).rejects.toSatisfy(isRenderAborted);
    await expect(queued).rejects.toThrow("render worker failed");
    const third = client.render(defaultRecipe(), SIZE);
    workers[1].reply();
    await expect(third).resolves.toBeDefined();
  });

  test("ignores events from a worker it has replaced", async () => {
    const { workers, client } = setup();
    void client.render(defaultRecipe(), SIZE).catch(() => undefined);
    const old = workers[0];
    old.dispatchEvent(new Event("error"));
    const next = client.render(defaultRecipe(), SIZE);
    old.dispatchEvent(new Event("error"));
    old.send({ requestId: workers[1].requests[0].requestId, ok: false, message: "stale" });
    expect(client.pending).toBe(1);
    workers[1].reply();
    await expect(next).resolves.toBeDefined();
  });

  test("gives up after three failures in a row and rejects at once", async () => {
    const { workers, client } = setup();
    for (let i = 0; i < 3; i++) {
      const result = client.render(defaultRecipe(), SIZE);
      workers[i].dispatchEvent(new ErrorEvent("error", { message: "404" }));
      await expect(result).rejects.toThrow("404");
    }
    await expect(client.render(defaultRecipe(), SIZE)).rejects.toThrow("404");
    expect(workers).toHaveLength(3);
  });

  test("a successful render resets the failure count", async () => {
    const { workers, client } = setup();
    const outcomes: Promise<unknown>[] = [];
    for (let i = 0; i < 3; i++) {
      const failing = client.render(defaultRecipe(), SIZE);
      workers[i].dispatchEvent(new Event("error"));
      outcomes.push(failing.catch(() => "failed"));
      const working = client.render(defaultRecipe(), SIZE);
      workers[i + 1].reply();
      outcomes.push(working.then(() => "rendered"));
    }
    expect(await Promise.all(outcomes)).toEqual([
      "failed",
      "rendered",
      "failed",
      "rendered",
      "failed",
      "rendered",
    ]);
  });

  test("dispose aborts unfinished renders and terminates the worker", async () => {
    const { worker, client } = setup();
    const result = client.render(defaultRecipe(), SIZE);
    client.dispose();
    await expect(result).rejects.toSatisfy(isRenderAborted);
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(client.pending).toBe(0);
  });

  test("render after dispose rejects without starting a worker", async () => {
    const { workers, client } = setup();
    client.dispose();
    await expect(client.render(defaultRecipe(), SIZE)).rejects.toThrow("stopped");
    expect(workers).toHaveLength(0);
  });

  test("ignores replies to requests it didn't send", () => {
    const { workers, client } = setup();
    void client.render(defaultRecipe(), SIZE).catch(() => undefined);
    const worker = workers[0];
    const image = { close: vi.fn<() => void>() };
    worker.send({ requestId: 99, ok: true, image: image as unknown as RenderImage });
    expect(image.close).toHaveBeenCalledOnce();
    expect(client.pending).toBe(1);
  });
});
