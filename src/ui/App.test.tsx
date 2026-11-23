import { fireEvent, render, screen } from "@testing-library/preact";
import { describe, expect, onTestFinished, test, vi } from "vitest";
import { Editor } from "../state/editor.ts";
import { App } from "./App.tsx";
import type { Renderer } from "./Preview.tsx";

function setup() {
  const editor = new Editor(undefined, () => 7);
  const renderer: Renderer = {
    render: vi.fn<Renderer["render"]>(() => new Promise(() => {})),
  };
  render(<App start="create" editor={editor} renderer={renderer} />);
  return { editor, renderer };
}

function slider(name: string): HTMLInputElement {
  return screen.getByRole<HTMLInputElement>("slider", { name });
}

function drag(input: HTMLInputElement, values: number[]): void {
  for (const value of values) {
    fireEvent.input(input, { target: { value: String(value) } });
  }
  fireEvent.change(input);
}

describe("App", () => {
  test("renders the app name as the main heading", () => {
    setup();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Eye-llusion");
  });

  test("labels the view controls", () => {
    setup();
    expect(slider("Repeats").value).toBe("8");
    expect(slider("Depth of field").getAttribute("aria-valuetext")).toBe("33%");
    expect(screen.getByRole<HTMLInputElement>("radio", { name: "Wall-eyed" }).checked).toBe(true);
    expect(screen.getByRole<HTMLInputElement>("radio", { name: "Stereogram" }).checked).toBe(true);
  });

  test("a slider drag changes the view and undoes as one step", () => {
    const { editor } = setup();
    const undo = screen.getByRole<HTMLButtonElement>("button", { name: "Undo" });
    expect(undo.disabled).toBe(true);

    drag(slider("Repeats"), [9, 10, 11]);
    expect(editor.recipe.value.view.repeats).toBe(11);
    expect(screen.getByText("11")).toBeTruthy();

    fireEvent.click(undo);
    expect(editor.recipe.value.view.repeats).toBe(8);
    expect(slider("Repeats").value).toBe("8");
    expect(undo.disabled).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Redo" }));
    expect(slider("Repeats").value).toBe("11");
  });

  test("mode, depth of field and new seed are separate undo steps", () => {
    const { editor } = setup();
    fireEvent.click(screen.getByRole("radio", { name: "Cross-eyed" }));
    drag(slider("Depth of field"), [0.5]);
    fireEvent.click(screen.getByRole("button", { name: "New seed" }));
    expect(editor.recipe.value).toMatchObject({
      seed: 7,
      view: { mode: "cross", depthOfField: 0.5 },
    });
    editor.undo();
    expect(editor.recipe.value.view.depthOfField).toBe(0.5);
    editor.undo();
    expect(editor.recipe.value.view.mode).toBe("cross");
    editor.undo();
    expect(editor.recipe.value.view.mode).toBe("wall");
  });

  test("keyboard shortcuts undo and redo, except in text fields", () => {
    const { editor } = setup();
    editor.setView({ repeats: 12 });
    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    expect(editor.recipe.value.view.repeats).toBe(8);
    fireEvent.keyDown(window, { key: "Z", metaKey: true, shiftKey: true });
    expect(editor.recipe.value.view.repeats).toBe(12);
    fireEvent.keyDown(slider("Repeats"), { key: "z", ctrlKey: true });
    expect(editor.recipe.value.view.repeats).toBe(8);
    fireEvent.keyDown(window, { key: "y", ctrlKey: true });
    expect(editor.recipe.value.view.repeats).toBe(12);

    const text = document.createElement("input");
    document.body.append(text);
    fireEvent.keyDown(text, { key: "z", ctrlKey: true });
    text.remove();
    expect(editor.recipe.value.view.repeats).toBe(12);
  });

  test("the sheet handle toggles the sheet open and closed", () => {
    setup();
    const handle = screen.getByRole("button", { name: "Controls" });
    expect(handle.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(handle);
    expect(handle.getAttribute("aria-expanded")).toBe("true");
    expect(document.querySelector(".shell")?.getAttribute("data-sheet")).toBe("half");
    fireEvent.click(handle);
    expect(handle.getAttribute("aria-expanded")).toBe("false");
  });

  test("View opens the viewer and going back closes it", async () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "View" }));
    expect(screen.getByRole("dialog", { name: "Viewer" })).toBeTruthy();
    expect(screen.queryByRole("complementary", { name: "Controls" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Exit" }));
    await vi.waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Viewer" })).toBeNull();
    });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "View" }));
  });

  test("narrow screens move Open, Save and Share into a menu", () => {
    vi.spyOn(window, "matchMedia").mockImplementation(
      (query) =>
        ({
          matches: query.includes("max-width"),
          media: query,
          addEventListener: () => {},
          removeEventListener: () => {},
        }) as unknown as MediaQueryList,
    );
    onTestFinished(() => {
      vi.restoreAllMocks();
    });
    setup();
    for (const name of ["Open", "Save", "Share"]) {
      expect(screen.queryByRole("button", { name })).toBeNull();
    }
    const more = screen.getByRole("button", { name: "More" });
    fireEvent.click(more);
    fireEvent.click(screen.getByRole("menuitem", { name: "Save" }));
    expect(screen.getByRole("dialog", { name: "Save PNG" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog", { name: "Save PNG" })).toBeNull();
    expect(document.activeElement).toBe(more);
  });
});
