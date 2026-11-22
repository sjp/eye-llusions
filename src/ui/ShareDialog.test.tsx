import { fireEvent, render, screen } from "@testing-library/preact";
import { afterEach, describe, expect, test, vi } from "vitest";
import { defaultRecipe, type ImageLayer, type Recipe } from "../core/recipe.ts";
import { createRandom } from "../core/random.ts";
import { Editor } from "../state/editor.ts";
import { encodeRecipe, linkPayload } from "../state/share.ts";
import { App } from "./App.tsx";
import type { Renderer } from "./Preview.tsx";

function setup() {
  const editor = new Editor(undefined, () => 7);
  const renderer: Renderer = {
    render: vi.fn<Renderer["render"]>(() => new Promise(() => {})),
  };
  render(<App editor={editor} renderer={renderer} />);
  return { editor };
}

function imageLayer(): ImageLayer {
  return {
    kind: "image",
    id: "image-1",
    name: "Image",
    visible: true,
    blend: "max",
    depth: 1,
    asset: "image-1",
    fit: "contain",
    invert: false,
    levels: { black: 0, white: 1 },
    blur: 0,
    posterize: null,
    threshold: null,
  };
}

async function link(recipe: Recipe): Promise<string> {
  return `#r=${await encodeRecipe(recipe)}`;
}

const stubbed: string[] = [];

/** Shadows navigator properties until the test ends. */
function stubNavigator(properties: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(properties)) {
    Object.defineProperty(navigator, key, { value, configurable: true });
    stubbed.push(key);
  }
}

afterEach(() => {
  history.replaceState(null, "", location.pathname);
  for (const key of stubbed.splice(0)) {
    Reflect.deleteProperty(navigator, key);
  }
});

describe("opening a share link", () => {
  test("loads the shared scene with nothing to undo", async () => {
    const shared = { ...defaultRecipe(), seed: 99 };
    history.replaceState(null, "", await link(shared));
    const { editor } = setup();
    await vi.waitFor(() => {
      expect(editor.recipe.value).toEqual(shared);
    });
    expect(editor.canUndo.value).toBe(false);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  test("a damaged link shows an error and keeps the default scene", async () => {
    const payload = await encodeRecipe(defaultRecipe());
    history.replaceState(null, "", `#r=${payload.slice(0, -12)}`);
    const { editor } = setup();
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("damaged or incomplete");
    expect(editor.recipe.value).toEqual(defaultRecipe());
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  test("a link opened later is an undo step, and missing images are pointed out", async () => {
    const { editor } = setup();
    const shared = { ...defaultRecipe(), layers: [imageLayer()] };
    history.replaceState(null, "", await link(shared));
    dispatchEvent(new HashChangeEvent("hashchange"));
    await vi.waitFor(() => {
      expect(editor.recipe.value).toEqual(shared);
    });
    expect(screen.getByText(/an image that a link can't carry/)).toBeTruthy();
    editor.undo();
    expect(editor.recipe.value).toEqual(defaultRecipe());
  });
});

describe("the share dialog", () => {
  test("copies the link and puts it in the address bar", async () => {
    const writeText = vi.fn<(text: string) => Promise<void>>(() => Promise.resolve());
    stubNavigator({ clipboard: { writeText }, share: undefined });
    const { editor } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Share" }));
    const input = await screen.findByRole<HTMLInputElement>("textbox", { name: "Link" });
    expect(screen.queryByRole("button", { name: "Share…" })).toBeNull();
    expect(location.hash).toBe("");

    fireEvent.click(screen.getByRole("button", { name: "Copy link" }));
    await screen.findByText("Link copied.");
    expect(writeText).toHaveBeenCalledWith(input.value);
    expect(location.href).toBe(input.value);
    const payload = linkPayload(location.hash);
    expect(payload).toBe(await encodeRecipe(editor.recipe.value));
    expect(screen.queryByText(/Images can't travel/)).toBeNull();
    expect(screen.queryByText(/cut links this long/)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  test("warns that images stay behind and that very long links may be cut", async () => {
    const share = vi.fn<(data: ShareData) => Promise<void>>(() => Promise.resolve());
    stubNavigator({ share });
    const { editor } = setup();
    // Scattered points barely compress, so they make a long link.
    const random = createRandom(1);
    const points = Array.from({ length: 6000 }, () => Math.floor(random.float() * 4096) / 4096);
    editor.updateLayers(
      (layers) => [
        ...layers,
        imageLayer(),
        {
          kind: "drawing",
          id: "drawing-1",
          name: "Drawing",
          visible: true,
          blend: "max",
          depth: 1,
          strokes: [{ brush: { size: 0.01, softness: 0, mode: "set", value: 1 }, points }],
        },
      ],
      { assets: { "image-1": { format: "gray", width: 1, height: 1, data: new Uint8Array(1) } } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Share" }));
    await screen.findByText(/cut links this long/);
    expect(screen.getByText(/Images can't travel in a link/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Share…" }));
    const url = screen.getByRole<HTMLInputElement>("textbox", { name: "Link" }).value;
    expect(share).toHaveBeenCalledWith({ title: "Eye-llusion", url });
    expect(location.href).toBe(url);
  });
});
