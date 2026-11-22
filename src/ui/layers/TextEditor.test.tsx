import { fireEvent, render, screen } from "@testing-library/preact";
import { expect, test, vi } from "vitest";
import { defaultRecipe, type TextLayer } from "../../core/recipe.ts";
import { Editor } from "../../state/editor.ts";
import { LayersPanel } from "./LayersPanel.tsx";

function setup() {
  const editor = new Editor({ ...defaultRecipe(), layers: [] });
  render(<LayersPanel editor={editor} />);
  fireEvent.click(screen.getByRole("button", { name: "Add text" }));
  const textbox = screen.getByRole<HTMLTextAreaElement>("textbox", { name: "Text" });
  const layer = (): TextLayer => {
    const only = editor.recipe.value.layers.at(0);
    if (only?.kind !== "text") {
      throw new Error("expected one text layer");
    }
    return only;
  };
  return { editor, textbox, layer };
}

function type(textbox: HTMLTextAreaElement, values: string[]): void {
  for (const value of values) {
    fireEvent.input(textbox, { target: { value } });
  }
}

test("adds a text layer with the bundled default font", () => {
  const { layer } = setup();
  expect(layer()).toMatchObject({ name: "Text", text: "HELLO", font: "anton", edge: "round" });
});

test("typing is one undo step per burst, ended by a pause or leaving the field", async () => {
  const { editor, textbox, layer } = setup();
  type(textbox, ["HELLO ", "HELLO W", "HELLO WO"]);
  expect(layer().text).toBe("HELLO WO");
  expect(editor.editing.value).toBe(true);
  vi.advanceTimersByTime(1000);
  expect(editor.editing.value).toBe(false);

  type(textbox, ["HELLO WOR", "HELLO WORLD"]);
  fireEvent.change(textbox);
  editor.undo();
  await vi.waitFor(() => {
    expect(textbox.value).toBe("HELLO WO");
  });
  editor.undo();
  await vi.waitFor(() => {
    expect(textbox.value).toBe("HELLO");
  });
});

test("edits font, size, position and edge", () => {
  const { textbox, layer } = setup();
  fireEvent.change(screen.getByRole("combobox", { name: "Font" }), {
    target: { value: "alfa-slab-one" },
  });
  fireEvent.input(screen.getByRole("slider", { name: "Size" }), { target: { value: "0.5" } });
  fireEvent.input(screen.getByRole("slider", { name: "Y position" }), {
    target: { value: "0.2" },
  });
  fireEvent.click(screen.getByRole("radio", { name: "Bevel" }));
  fireEvent.input(screen.getByRole("slider", { name: "Edge width" }), {
    target: { value: "0.1" },
  });
  expect(layer()).toMatchObject({
    font: "alfa-slab-one",
    size: 0.5,
    center: { x: 0.5, y: 0.2 },
    edge: "bevel",
    edgeWidth: 0.1,
  });
  fireEvent.click(screen.getByRole("radio", { name: "Flat" }));
  expect(screen.queryByRole("slider", { name: "Edge width" })).toBeNull();
  expect(textbox.getAttribute("aria-describedby")).toBeNull();
});

test("warns about characters the fonts don't include", () => {
  const { textbox } = setup();
  type(textbox, ["Hi 🙂"]);
  expect(screen.getByText(/The fonts don't include 🙂/)).toBeTruthy();
  expect(textbox.getAttribute("aria-describedby")).not.toBeNull();
});
