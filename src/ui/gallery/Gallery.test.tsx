import { cleanup, fireEvent, render, screen } from "@testing-library/preact";
import { options } from "preact";
import { describe, expect, onTestFinished, test, vi } from "vitest";
import type { RenderImage } from "../../render/client.ts";
import { Editor } from "../../state/editor.ts";
import { encodeRecipe, shareUrl } from "../../state/share.ts";
import { App } from "../App.tsx";
import type { Renderer } from "../Preview.tsx";
import { Gallery } from "./Gallery.tsx";
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

  test("a thumbnail render that ends after leaving the gallery updates nothing", async () => {
    vi.stubGlobal("IntersectionObserver", undefined);
    onTestFinished(() => {
      vi.unstubAllGlobals();
    });
    const fails: ((error: Error) => void)[] = [];
    const thumbnails: Renderer = {
      render: vi.fn<Renderer["render"]>(
        () =>
          new Promise((_resolve, reject) => {
            fails.push(reject);
          }),
      ),
    };
    render(
      <Gallery renderer={thumbnails} onView={() => {}} onRemix={() => {}} onBlank={() => {}} />,
    );
    await vi.waitFor(() => {
      expect(fails).toHaveLength(1);
    });
    cleanup();
    // Effect cleanups run after the next paint.
    await vi.advanceTimersByTimeAsync(100);
    // A state update on the unmounted gallery would schedule a render.
    const debounce = Object.getOwnPropertyDescriptor(options, "debounceRendering");
    const scheduled = vi.fn<(callback: () => void) => void>((callback) => {
      callback();
    });
    options.debounceRendering = scheduled;
    onTestFinished(() => {
      if (debounce === undefined) {
        Reflect.deleteProperty(options, "debounceRendering");
      } else {
        Object.defineProperty(options, "debounceRendering", debounce);
      }
    });
    fails[0](new Error("Worker failed"));
    await vi.advanceTimersByTimeAsync(0);
    expect(scheduled).not.toHaveBeenCalled();
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

  test("tapping a thumbnail views its sample", () => {
    const { editor } = setup();
    fireEvent.click(screen.getByRole("img", { name: `${GALLERY[1].title} stereogram` }));
    expect(editor.recipe.value).toBe(GALLERY[1].recipe);
    expect(screen.getByRole("dialog", { name: "Viewer" })).toBeTruthy();
  });

  test("the viewer moves between samples with its buttons, arrow keys and swipes", async () => {
    const { editor } = setup();
    const last = GALLERY.at(-1);
    fireEvent.click(screen.getByRole("button", { name: `View ${first.title}` }));
    expect(screen.getByText(first.title, { selector: ".viewer-title" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Next sample" }));
    expect(editor.recipe.value).toBe(GALLERY[1].recipe);
    expect(screen.getByText(GALLERY[1].title, { selector: ".viewer-title" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Previous sample" }));
    fireEvent.click(screen.getByRole("button", { name: "Previous sample" }));
    // Round from the first to the last.
    expect(editor.recipe.value).toBe(last?.recipe);
    expect(editor.canUndo.value).toBe(false);

    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(editor.recipe.value).toBe(first.recipe);
    fireEvent.keyDown(window, { key: "ArrowLeft", altKey: true });
    expect(editor.recipe.value).toBe(first.recipe);

    const area = document.querySelector(".viewer-area");
    if (area === null) {
      throw new Error("No viewer area");
    }
    const swipe = (dx: number, dy: number, pointerType = "touch") => {
      fireEvent.pointerDown(area, {
        pointerId: 5,
        pointerType,
        isPrimary: true,
        clientX: 200,
        clientY: 200,
      });
      fireEvent.pointerUp(area, {
        pointerId: 5,
        pointerType,
        clientX: 200 + dx,
        clientY: 200 + dy,
      });
    };
    swipe(-120, 10);
    expect(editor.recipe.value).toBe(GALLERY[1].recipe);
    swipe(120, 0);
    expect(editor.recipe.value).toBe(first.recipe);
    // Too short, too steep, or a mouse drag.
    swipe(-30, 0);
    swipe(-100, 80);
    swipe(-120, 0, "mouse");
    expect(editor.recipe.value).toBe(first.recipe);

    swipe(-120, 0);
    fireEvent.click(screen.getByRole("button", { name: "Exit" }));
    await vi.waitFor(() => {
      expect(document.activeElement?.getAttribute("aria-label")).toBe(`View ${GALLERY[1].title}`);
    });
  });

  test("a viewer opened from Create doesn't move between samples", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: `Remix ${first.title}` }));
    fireEvent.click(screen.getByRole("button", { name: "View" }));
    expect(screen.getByRole("dialog", { name: "Viewer" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Next sample" })).toBeNull();
  });

  test("leaving the viewer focuses the View button that opened it", async () => {
    setup();
    const view = screen.getByRole("button", { name: `View ${GALLERY[2].title}` });
    fireEvent.click(view);
    fireEvent.click(screen.getByRole("button", { name: "Exit" }));
    await vi.waitFor(() => {
      expect(document.activeElement?.getAttribute("aria-label")).toBe(`View ${GALLERY[2].title}`);
    });
  });

  test("moving between the gallery and Create focuses the new screen's heading", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: `Remix ${first.title}` }));
    expect(document.activeElement).toBe(screen.getByRole("heading", { level: 1 }));
    expect(document.activeElement?.closest(".toolbar")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Gallery" }));
    expect(document.activeElement).toBe(screen.getByRole("heading", { level: 1 }));
    expect(document.activeElement?.closest(".gallery")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Start from blank" }));
    expect(document.activeElement).toBe(screen.getByRole("heading", { level: 1 }));
  });

  test("keep editing returns focus to the Gallery button", () => {
    const { editor } = setup();
    fireEvent.click(screen.getByRole("button", { name: `Remix ${first.title}` }));
    editor.newSeed();
    fireEvent.click(screen.getByRole("button", { name: "Gallery" }));
    fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Gallery" }));
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

  test("the browser asks before unloading a changed scene in Create", async () => {
    const { editor } = setup();
    const unload = (): boolean => {
      const event = new Event("beforeunload", { cancelable: true });
      dispatchEvent(event);
      return event.defaultPrevented;
    };
    fireEvent.click(screen.getByRole("button", { name: "Start from blank" }));
    expect(unload()).toBe(false);
    editor.newSeed();
    await vi.waitFor(() => {
      expect(unload()).toBe(true);
    });
    editor.markSaved({ withAssets: true });
    await vi.waitFor(() => {
      expect(unload()).toBe(false);
    });
    editor.newSeed();
    fireEvent.click(screen.getByRole("button", { name: "Gallery" }));
    fireEvent.click(screen.getByRole("button", { name: "Go to gallery" }));
    expect(unload()).toBe(false);
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
