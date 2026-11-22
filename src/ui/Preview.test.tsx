import { render, screen } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { RenderImage } from "../render/client.ts";
import type { RenderOutput } from "../render/protocol.ts";
import { Editor } from "../state/editor.ts";
import { Preview, type Renderer } from "./Preview.tsx";

type Call = {
  repeats: number;
  width: number;
  output: RenderOutput | undefined;
  resolve: (image: RenderImage) => void;
  reject: (error: Error) => void;
};

/** Lets the preview's promise chain catch up. */
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await Promise.resolve();
  }
}

async function finish(call: Call): Promise<void> {
  call.resolve(new ImageData(call.width, 1));
  await settle();
}

async function fail(call: Call, error: Error): Promise<void> {
  call.reject(error);
  await settle();
}

/** A renderer whose renders finish only when the test says so. */
function fakeRenderer() {
  const calls: Call[] = [];
  const renderer: Renderer = {
    render: (recipe, size, options) =>
      new Promise<RenderImage>((resolve, reject) => {
        calls.push({
          repeats: recipe.view.repeats,
          width: size.width,
          output: options?.output,
          resolve,
          reject,
        });
      }),
  };
  return { renderer, calls };
}

function setup(output: RenderOutput = "stereogram") {
  const editor = new Editor();
  const { renderer, calls } = fakeRenderer();
  const view = render(<Preview editor={editor} renderer={renderer} output={output} />);
  const summary = () =>
    calls.map(({ repeats, width, output: wanted }) => ({ repeats, width, output: wanted }));
  return { editor, renderer, calls, summary, view };
}

function canvas(): HTMLCanvasElement {
  return screen.getByRole<HTMLCanvasElement>("img");
}

describe("Preview", () => {
  beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
      DOMRect.fromRect({ width: 400, height: 300 }),
    );
    vi.stubGlobal("devicePixelRatio", 2);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  test("renders in full at the device pixel ratio on mount", async () => {
    const { calls, summary } = setup();
    expect(summary()).toEqual([{ repeats: 8, width: 800, output: "stereogram" }]);
    await finish(calls[0]);
    expect(canvas().width).toBe(800);
    expect(canvas().dataset).toMatchObject({ quality: "full", output: "stereogram" });
    expect(canvas().style.width).toBe("400px");
    expect(canvas().style.height).toBe("225px");
  });

  test("renders drafts during a coalesced edit and in full once it settles", async () => {
    const { editor, calls, summary } = setup();
    await finish(calls[0]);
    editor.setView({ repeats: 9 }, { coalesce: "repeats" });
    // Waits for the draft in flight, then renders only the newest change.
    editor.setView({ repeats: 10 }, { coalesce: "repeats" });
    editor.setView({ repeats: 11 }, { coalesce: "repeats" });
    editor.endEdit();
    expect(summary().slice(1)).toEqual([{ repeats: 9, width: 400, output: "stereogram" }]);
    await finish(calls[1]);
    expect(canvas().dataset["quality"]).toBe("draft");
    expect(summary().slice(2)).toEqual([{ repeats: 11, width: 400, output: "stereogram" }]);
    await finish(calls[2]);
    vi.advanceTimersByTime(150);
    expect(summary().slice(3)).toEqual([{ repeats: 11, width: 800, output: "stereogram" }]);
    await finish(calls[3]);
    expect(canvas().dataset).toMatchObject({ quality: "full", renders: "4" });
  });

  test("renders discrete changes in full at once", async () => {
    const { editor, calls, summary } = setup();
    await finish(calls[0]);
    editor.setView({ mode: "cross" });
    expect(summary().slice(1)).toEqual([{ repeats: 8, width: 800, output: "stereogram" }]);
  });

  test("re-renders when the output changes and labels the canvas", async () => {
    const { calls, view, renderer, editor, summary } = setup();
    await finish(calls[0]);
    view.rerender(<Preview editor={editor} renderer={renderer} output="depth" />);
    expect(summary().at(-1)?.output).toBe("depth");
    expect(screen.getByRole("img", { name: "Depth map preview" })).toBeTruthy();
  });

  test("shows render errors", async () => {
    const { calls } = setup();
    await fail(calls[0], new Error("out of memory"));
    expect(screen.getByRole("alert").textContent).toContain("out of memory");
  });
});
