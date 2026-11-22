import { fireEvent, render, screen, within } from "@testing-library/preact";
import { describe, expect, test, vi } from "vitest";
import { RECIPE_LIMITS } from "../../core/parseRecipe.ts";
import { defaultRecipe, type Layer } from "../../core/recipe.ts";
import { Editor } from "../../state/editor.ts";
import { LayersPanel } from "./LayersPanel.tsx";

function setup(layers?: Layer[]) {
  const recipe = defaultRecipe();
  const editor = new Editor(layers === undefined ? recipe : { ...recipe, layers });
  render(<LayersPanel editor={editor} />);
  return editor;
}

/** Layer names as listed, top first. */
function listed(): (string | undefined)[] {
  const list = screen.getByRole("list", { name: "Layer stack, top first" });
  return within(list)
    .getAllByRole("listitem")
    .map((item) => item.querySelector(".layer-name")?.textContent);
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

const click = (name: string): void => {
  fireEvent.click(screen.getByRole("button", { name }));
};

describe("LayersPanel", () => {
  test("adds a shape above the selected layer and selects it", () => {
    const editor = setup();
    click("Add shape");
    click("Add shape");
    expect(editor.recipe.value.layers.map((layer) => layer.name)).toEqual([
      "Sphere",
      "Sphere 2",
      "Sphere 3",
    ]);
    expect(screen.getByRole("button", { pressed: true }).textContent).toBe("Sphere 3");
    editor.undo();
    expect(editor.recipe.value.layers).toHaveLength(2);
  });

  test("renames, duplicates and deletes the selected layer, each undoable", () => {
    const editor = setup();
    const name = screen.getByRole<HTMLInputElement>("textbox", { name: "Name" });
    fireEvent.input(name, { target: { value: "Ba" } });
    fireEvent.input(name, { target: { value: "Ball" } });
    fireEvent.change(name);
    click("Duplicate");
    expect(editor.recipe.value.layers.map((layer) => layer.name)).toEqual(["Ball", "Ball copy"]);
    expect(screen.getByRole("button", { pressed: true }).textContent).toBe("Ball copy");

    click("Delete");
    expect(editor.recipe.value.layers.map((layer) => layer.name)).toEqual(["Ball"]);
    expect(screen.getByRole("button", { pressed: true }).textContent).toBe("Ball");

    editor.undo();
    expect(editor.recipe.value.layers).toHaveLength(2);
    editor.undo();
    expect(editor.recipe.value.layers).toHaveLength(1);
    editor.undo();
    expect(editor.recipe.value.layers[0].name).toBe("Sphere");
  });

  test("moves layers up and down and lists the top layer first", async () => {
    const editor = setup();
    click("Add shape");
    expect(listed()).toEqual(["Sphere 2", "Sphere"]);
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "Move Sphere 2 up" }).disabled,
    ).toBe(true);
    click("Move Sphere 2 down");
    expect(listed()).toEqual(["Sphere", "Sphere 2"]);
    click("Move Sphere 2 up");
    expect(listed()).toEqual(["Sphere 2", "Sphere"]);
    editor.undo();
    await vi.waitFor(() => {
      expect(listed()).toEqual(["Sphere", "Sphere 2"]);
    });
  });

  test("toggles visibility", () => {
    const editor = setup();
    fireEvent.click(screen.getByRole("checkbox", { name: "Show Sphere" }));
    expect(editor.recipe.value.layers[0].visible).toBe(false);
    editor.undo();
    expect(editor.recipe.value.layers[0].visible).toBe(true);
  });

  test("edits depth, blend mode and shape settings", () => {
    const editor = setup();
    drag(slider("Depth"), [0.8, 0.6]);
    fireEvent.change(screen.getByRole("combobox", { name: "Blend" }), {
      target: { value: "subtract" },
    });
    fireEvent.click(screen.getByRole("radio", { name: "Ripples" }));
    drag(slider("Rings"), [5, 6]);
    drag(slider("X position"), [0.3]);
    drag(slider("Size"), [1.2]);
    expect(editor.recipe.value.layers[0]).toMatchObject({
      depth: 0.6,
      blend: "subtract",
      shape: { type: "ripples", rings: 6 },
      center: { x: 0.3, y: 0.5 },
      size: 1.2,
    });
    for (let step = 0; step < 4; step++) {
      editor.undo();
    }
    expect(editor.recipe.value.layers[0]).toMatchObject({
      blend: "subtract",
      shape: { type: "sphere" },
    });
    editor.undo();
    editor.undo();
    expect(editor.recipe.value).toEqual(defaultRecipe());
  });

  test("shows each shape's own parameters", () => {
    setup();
    expect(screen.queryByRole("slider", { name: "Sides" })).toBeNull();
    fireEvent.click(screen.getByRole("radio", { name: "Pyramid" }));
    expect(slider("Sides").value).toBe("4");
    fireEvent.click(screen.getByRole("radio", { name: "Spiral stairs" }));
    expect(slider("Steps").value).toBe("16");
    expect(slider("Turns").value).toBe("2");
    fireEvent.click(screen.getByRole("radio", { name: "Torus" }));
    expect(slider("Thickness").getAttribute("aria-valuetext")).toBe("40%");
  });

  test("stops adding layers at the limit", () => {
    const sphere = defaultRecipe().layers[0];
    const layers = Array.from({ length: RECIPE_LIMITS.layers }, (_, i) => ({
      ...sphere,
      id: `l${String(i)}`,
    }));
    setup(layers);
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Add shape" }).disabled).toBe(
      true,
    );
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Duplicate" }).disabled).toBe(
      true,
    );
    expect(screen.getByText(/up to 32 layers/)).toBeTruthy();
  });

  test("an empty stack offers only adding", () => {
    const editor = setup([]);
    expect(screen.queryByRole("list")).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
    click("Add shape");
    expect(editor.recipe.value.layers).toHaveLength(1);
  });
});
