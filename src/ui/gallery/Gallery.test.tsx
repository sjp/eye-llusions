import { fireEvent, render, screen } from "@testing-library/preact";
import { describe, expect, test, vi } from "vitest";
import type { RenderImage } from "../../render/client.ts";
import { Editor } from "../../state/editor.ts";
import { encodeRecipe, shareUrl } from "../../state/share.ts";
import { App } from "../App.tsx";
import type { Renderer } from "../Preview.tsx";
import { GALLERY } from "./samples.ts";

type Call = { recipe: unknown; resolve: (image: RenderImage) => void };

function setup() {
  const editor = new Editor(undefined, () => 7);
  const renderer: Renderer = {
    render: vi.fn<Renderer["render"]>(() => new Promise(() => {})),
  };
  const calls: Call[] = [];
  const thumbnails: Renderer = {
    render: vi.fn<Renderer["render"]>(
      (recipe, size) =>
        new Promise((resolve) => {
          calls.push({
            recipe,
            resolve: () => {
              resolve(new ImageData(size.width, size.height));
            },
          });
        }),
    ),
  };
  render(<App editor={editor} renderer={renderer} thumbnailRenderer={thumbnails} />);
  return { editor, renderer, calls };
}

const first = GALLERY[0];

describe("the gallery", () => {
  test("is the first screen, with every sample and a blank start", () => {
    setup();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Eye-llusion");
    expect(screen.getAllByRole("listitem")).toHaveLength(GALLERY.length);
    expect(screen.getByRole("button", { name: `View ${first.title}` })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Start from blank" })).toBeTruthy();
    expect(screen.queryByRole("complementary", { name: "Controls" })).toBeNull();
  });

  test("renders thumbnails one at a time, in order", async () => {
    vi.stubGlobal("IntersectionObserver", undefined);
    const { calls } = setup();
    for (const [index, sample] of GALLERY.slice(0, 3).entries()) {
      await vi.waitFor(() => {
        expect(calls).toHaveLength(index + 1);
      });
      expect(calls[index].recipe).toBe(sample.recipe);
      calls[index].resolve(new ImageData(1, 1));
    }
    await vi.waitFor(() => {
      expect(screen.getByRole("img", { name: `${first.title} stereogram` }).dataset["ready"]).toBe(
        "true",
      );
    });
    vi.unstubAllGlobals();
  });

  test("remix opens the sample in Create with nothing to undo", () => {
    const { editor } = setup();
    fireEvent.click(screen.getByRole("button", { name: `Remix ${first.title}` }));
    expect(editor.recipe.value).toBe(first.recipe);
    expect(screen.getByRole("complementary", { name: "Controls" })).toBeTruthy();
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Undo" }).disabled).toBe(true);
  });

  test("view opens the sample in the viewer and returns to the gallery", async () => {
    const { editor } = setup();
    fireEvent.click(screen.getByRole("button", { name: `View ${first.title}` }));
    expect(editor.recipe.value).toBe(first.recipe);
    expect(screen.getByRole("dialog", { name: "Viewer" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Exit" }));
    await vi.waitFor(() => {
      expect(screen.getByRole("button", { name: "Start from blank" })).toBeTruthy();
    });
  });

  test("going back from an unchanged scene doesn't ask", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Start from blank" }));
    fireEvent.click(screen.getByRole("button", { name: "Gallery" }));
    expect(screen.getByRole("button", { name: "Start from blank" })).toBeTruthy();
  });

  test("going back from a changed scene asks first", () => {
    const { editor } = setup();
    fireEvent.click(screen.getByRole("button", { name: `Remix ${first.title}` }));
    editor.newSeed();
    fireEvent.click(screen.getByRole("button", { name: "Gallery" }));
    expect(screen.getByRole("dialog", { name: "Leave this scene?" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(screen.queryByRole("dialog", { name: "Leave this scene?" })).toBeNull();
    expect(editor.recipe.value.seed).toBe(7);

    fireEvent.click(screen.getByRole("button", { name: "Gallery" }));
    fireEvent.click(screen.getByRole("button", { name: "Go to gallery" }));
    expect(screen.getByRole("button", { name: "Start from blank" })).toBeTruthy();
  });

  test("a shared or saved scene no longer counts as changed", () => {
    const { editor } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Start from blank" }));
    editor.newSeed();
    editor.markSaved({ withAssets: true });
    fireEvent.click(screen.getByRole("button", { name: "Gallery" }));
    expect(screen.queryByRole("dialog", { name: "Leave this scene?" })).toBeNull();
    expect(screen.getByRole("button", { name: "Start from blank" })).toBeTruthy();
  });

  test("a shared link opens in Create, and going back takes it out of the address", async () => {
    const shared = GALLERY[1].recipe;
    history.replaceState(null, "", shareUrl(location.href, await encodeRecipe(shared)));
    const { editor } = setup();
    expect(screen.getByRole("complementary", { name: "Controls" })).toBeTruthy();
    await vi.waitFor(() => {
      expect(editor.recipe.value).toEqual(shared);
    });
    fireEvent.click(screen.getByRole("button", { name: "Gallery" }));
    expect(location.hash).toBe("");

    fireEvent.click(screen.getByRole("button", { name: `Remix ${first.title}` }));
    fireEvent.click(screen.getByRole("button", { name: "Gallery" }));
    history.replaceState(null, "", shareUrl(location.href, await encodeRecipe(shared)));
    dispatchEvent(new HashChangeEvent("hashchange"));
    await vi.waitFor(() => {
      expect(editor.recipe.value).toEqual(shared);
    });
    expect(screen.getByRole("complementary", { name: "Controls" })).toBeTruthy();
    history.replaceState(null, "", location.pathname);
  });
});
