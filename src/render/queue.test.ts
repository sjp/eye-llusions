import { describe, expect, test, vi } from "vitest";
import { defaultRecipe } from "../core/recipe.ts";
import type { RenderRequest, RenderResponse } from "./protocol.ts";
import { createRenderQueue, type Reply } from "./queue.ts";

function request(requestId: number): RenderRequest {
  return {
    requestId,
    recipe: defaultRecipe(),
    width: 4,
    height: 4,
    oversample: 1,
    output: "stereogram",
    assets: {},
    assetIds: [],
  };
}

const image = new ImageData(4, 4);

describe("createRenderQueue", () => {
  test("replies to each request in order", async () => {
    const replies: RenderResponse[] = [];
    const enqueue = createRenderQueue(
      () => Promise.resolve({ image, transfer: [] }),
      (response) => {
        replies.push(response);
      },
    );
    void enqueue(request(1));
    await enqueue(request(2));
    expect(replies.map((r) => [r.requestId, r.ok])).toEqual([
      [1, true],
      [2, true],
    ]);
  });

  test("a failing render replies with its error and doesn't block the next", async () => {
    const replies: RenderResponse[] = [];
    const enqueue = createRenderQueue(
      (r) =>
        r.requestId === 1
          ? Promise.reject(new Error("boom"))
          : Promise.resolve({ image, transfer: [] }),
      (response) => {
        replies.push(response);
      },
    );
    void enqueue(request(1));
    await enqueue(request(2));
    expect(replies).toEqual([
      { requestId: 1, ok: false, message: "boom" },
      { requestId: 2, ok: true, image },
    ]);
  });

  test("a reply that can't be sent becomes an error reply and doesn't block the next", async () => {
    const replies: RenderResponse[] = [];
    const reply = vi.fn<Reply>((response) => {
      if (response.ok && response.requestId === 1) {
        throw new DOMException("could not be cloned", "DataCloneError");
      }
      replies.push(response);
    });
    const enqueue = createRenderQueue(() => Promise.resolve({ image, transfer: [] }), reply);
    void enqueue(request(1));
    await enqueue(request(2));
    expect(replies).toEqual([
      { requestId: 1, ok: false, message: "could not be cloned" },
      { requestId: 2, ok: true, image },
    ]);
  });

  test("keeps going when even the error reply can't be sent", async () => {
    const replies: RenderResponse[] = [];
    let calls = 0;
    const enqueue = createRenderQueue(
      () => Promise.resolve({ image, transfer: [] }),
      (response) => {
        calls++;
        if (calls <= 2) {
          throw new Error("closed");
        }
        replies.push(response);
      },
    );
    await expect(enqueue(request(1))).resolves.toBeUndefined();
    await enqueue(request(2));
    expect(replies).toEqual([{ requestId: 2, ok: true, image }]);
  });
});
