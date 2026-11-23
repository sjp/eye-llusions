import { describe, expect, test, vi } from "vitest";
import { defaultRecipe } from "../core/recipe.ts";
import type { RenderRequest, RenderResponse, WorkerMessage } from "./protocol.ts";
import { createRenderQueue, type Reply } from "./queue.ts";

function request(requestId: number): RenderRequest {
  return {
    type: "render",
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

  describe("cancellation", () => {
    /** A queue whose request 1 is a long render that takes 5 ms a band. */
    function slowFirst() {
      let clock = 0;
      let bands = 0;
      const started: number[] = [];
      const replies: RenderResponse[] = [];
      const enqueue = createRenderQueue(
        async (r, pause) => {
          started.push(r.requestId);
          await pause();
          if (r.requestId === 1) {
            for (let band = 0; band < 1000; band++) {
              clock += 5;
              bands++;
              await pause();
            }
          }
          return { image, transfer: [] };
        },
        (response) => {
          replies.push(response);
        },
        { sliceMs: 10, now: () => clock },
      );
      return { enqueue, started, replies, bands: () => bands };
    }

    const cancel = (requestId: number): WorkerMessage => ({ type: "cancel", requestId });

    test("a cancelled render stops at its next pause and the next one starts at once", async () => {
      const { enqueue, started, replies, bands } = slowFirst();
      void enqueue(request(1));
      await vi.advanceTimersToNextTimerAsync();
      await vi.advanceTimersToNextTimerAsync();
      expect(started).toEqual([1]);
      const before = bands();
      expect(before).toBeGreaterThan(0);

      void enqueue(cancel(1));
      const second = enqueue(request(2));
      await vi.advanceTimersToNextTimerAsync();
      await second;
      expect(bands() - before).toBeLessThanOrEqual(2);
      expect(started).toEqual([1, 2]);
      expect(replies).toEqual([
        { requestId: 1, ok: false, message: "Cancelled" },
        { requestId: 2, ok: true, image },
      ]);
    });

    test("a newer request supersedes the one being rendered", async () => {
      const { enqueue, replies, bands } = slowFirst();
      void enqueue(request(1));
      await vi.advanceTimersToNextTimerAsync();
      const second = enqueue(request(2));
      await vi.runAllTimersAsync();
      await second;
      expect(bands()).toBeLessThan(1000);
      expect(replies.map((r) => [r.requestId, r.ok])).toEqual([
        [1, false],
        [2, true],
      ]);
    });

    test("a request cancelled while waiting is answered without rendering", async () => {
      const { enqueue, started, replies, bands } = slowFirst();
      void enqueue(request(1));
      const done = enqueue(cancel(1));
      await vi.runAllTimersAsync();
      await done;
      expect(started).toEqual([1]);
      expect(bands()).toBe(0);
      expect(replies).toEqual([{ requestId: 1, ok: false, message: "Cancelled" }]);
    });

    test("pauses don't yield until the time slice is used up", async () => {
      let pauses = 0;
      const enqueue = createRenderQueue(
        async (_request, pause) => {
          for (let i = 0; i < 100; i++) {
            await pause();
            pauses++;
          }
          return { image, transfer: [] };
        },
        () => undefined,
        { sliceMs: 10, now: () => 0 },
      );
      await enqueue(request(1));
      expect(pauses).toBe(100);
      expect(vi.getTimerCount()).toBe(0);
    });
  });
});
