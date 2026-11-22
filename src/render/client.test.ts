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

function setup(): { worker: FakeWorker; client: RenderClient } {
  const worker = new FakeWorker();
  return { worker, client: new RenderClient(worker as unknown as Worker) };
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

  test("a worker error rejects pending renders and resends assets afterwards", async () => {
    const { worker, client } = setup();
    const a = asset(1);
    const first = client.render(withAssets({ a }), SIZE);
    worker.requests.length = 0;
    worker.dispatchEvent(new Event("error"));
    await expect(first).rejects.toThrow("render worker failed");
    void client.render(withAssets({ a }), SIZE);
    expect(Object.keys(worker.requests[0].assets)).toEqual(["a"]);
  });

  test("dispose aborts unfinished renders and terminates the worker", async () => {
    const { worker, client } = setup();
    const result = client.render(defaultRecipe(), SIZE);
    client.dispose();
    await expect(result).rejects.toSatisfy(isRenderAborted);
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(client.pending).toBe(0);
  });

  test("ignores replies to requests it didn't send", () => {
    const { worker, client } = setup();
    const image = { close: vi.fn<() => void>() };
    worker.send({ requestId: 99, ok: true, image: image as unknown as RenderImage });
    expect(image.close).toHaveBeenCalledOnce();
    expect(client.pending).toBe(0);
  });
});
