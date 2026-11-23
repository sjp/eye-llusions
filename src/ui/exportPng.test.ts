import { describe, expect, test, vi } from "vitest";
import { defaultRecipe } from "../core/recipe.ts";
import { EXPORT_OVERSAMPLE } from "../render/resolution.ts";
import { renderPng } from "./exportPng.ts";

const dispose = vi.fn<() => void>();
const render = vi.fn<(...args: unknown[]) => Promise<never>>();

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

describe("renderPng", () => {
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
    render.mockClear();
    const controller = new AbortController();
    controller.abort();
    await expect(
      renderPng(defaultRecipe(), { width: 8, height: 8 }, controller.signal),
    ).rejects.toThrow("aborted");
    expect(render).not.toHaveBeenCalled();
  });
});
