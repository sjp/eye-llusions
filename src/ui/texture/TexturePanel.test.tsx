import { fireEvent, render, screen } from "@testing-library/preact";
import { expect, test } from "vitest";
import { defaultRecipe } from "../../core/recipe.ts";
import { scaleLimits } from "../../core/texture/scale.ts";
import { Editor } from "../../state/editor.ts";
import { TexturePanel } from "./TexturePanel.tsx";

function setup() {
  const editor = new Editor(defaultRecipe(), () => 99);
  render(<TexturePanel editor={editor} />);
  return editor;
}

test("offers every generator and preset, with the current ones checked", () => {
  setup();
  for (const name of ["Dots", "Noise", "Marble", "Cells", "Shapes", "Tile", "Custom"]) {
    expect(screen.getByRole("radio", { name })).toBeTruthy();
  }
  expect(screen.getByRole<HTMLInputElement>("radio", { name: "Dots" }).checked).toBe(true);
  expect(screen.getByRole<HTMLInputElement>("radio", { name: "Mono" }).checked).toBe(true);
  expect(screen.getAllByRole("radio")).toHaveLength(13);
});

test("switching generator starts from its defaults and is undoable", () => {
  const editor = setup();
  fireEvent.click(screen.getByRole("radio", { name: "Marble" }));
  expect(editor.recipe.value.texture.generator).toEqual({ type: "fractalNoise", octaves: 4 });
  expect(screen.getByRole("slider", { name: "Detail" })).toBeTruthy();
  expect(screen.queryByRole("slider", { name: "Dot density" })).toBeNull();
  editor.undo();
  expect(editor.recipe.value.texture.generator.type).toBe("randomDots");
});

test("choosing a palette preset sets it", () => {
  const editor = setup();
  fireEvent.click(screen.getByRole("radio", { name: "Ocean" }));
  expect(editor.recipe.value.texture.palette).toEqual({ type: "preset", id: "ocean" });
});

test("a generator parameter drag is one undo step", () => {
  const editor = setup();
  fireEvent.click(screen.getByRole("radio", { name: "Cells" }));
  const slider = screen.getByRole("slider", { name: "Edge shading" });
  for (const value of ["0.5", "0.6", "0.7"]) {
    fireEvent.input(slider, { target: { value } });
  }
  fireEvent.change(slider);
  expect(editor.recipe.value.texture.generator).toEqual({ type: "cells", shading: 0.7 });
  editor.undo();
  expect(editor.recipe.value.texture.generator).toEqual({ type: "cells", shading: 0.4 });
});

test("the scale slider is logarithmic and spans the fusible range", () => {
  const editor = setup();
  const { aspect, view } = defaultRecipe();
  const { min, max } = scaleLimits("randomDots", aspect, view.repeats);
  const slider = screen.getByRole<HTMLInputElement>("slider", { name: "Scale" });
  expect(Number(slider.min)).toBeCloseTo(Math.log2(min), 6);
  expect(Number(slider.max)).toBeCloseTo(Math.log2(max), 6);
  fireEvent.input(slider, { target: { value: "1" } });
  fireEvent.change(slider);
  expect(editor.recipe.value.texture.scale).toBeCloseTo(2, 6);
  expect(slider.getAttribute("aria-valuetext")).toBe("2.00×");
});

test("new texture seed reshuffles the texture alone", () => {
  const editor = setup();
  fireEvent.click(screen.getByRole("button", { name: "New texture seed" }));
  expect(editor.recipe.value.texture.seed).toBe(99);
  expect(editor.recipe.value.seed).toBe(defaultRecipe().seed);
});

test("a custom palette starts from the palette in use", () => {
  const editor = setup();
  fireEvent.click(screen.getByRole("radio", { name: "Ocean" }));
  fireEvent.click(screen.getByRole("radio", { name: "Custom" }));
  expect(editor.recipe.value.texture.palette).toEqual({
    type: "custom",
    stops: ["#031a33", "#0a4f7a", "#1fa2c2", "#9be7f0"],
  });
  expect(screen.getAllByLabelText(/^Colour \d$/)).toHaveLength(4);
});

test("custom colours can be added, removed, reordered and changed", () => {
  const editor = setup();
  fireEvent.click(screen.getByRole("radio", { name: "Custom" }));
  const stops = () => {
    const { palette } = editor.recipe.value.texture;
    return palette.type === "custom" ? palette.stops : [];
  };
  expect(stops()).toEqual(["#000000", "#ffffff"]);
  expect(screen.getByRole<HTMLButtonElement>("button", { name: "Remove colour 1" }).disabled).toBe(
    true,
  );

  fireEvent.click(screen.getByRole("button", { name: "Add colour" }));
  expect(stops()).toEqual(["#000000", "#808080", "#ffffff"]);
  fireEvent.click(screen.getByRole("button", { name: "Move colour 1 down" }));
  expect(stops()).toEqual(["#808080", "#000000", "#ffffff"]);
  fireEvent.click(screen.getByRole("button", { name: "Remove colour 2" }));
  expect(stops()).toEqual(["#808080", "#ffffff"]);

  const colour = screen.getByLabelText("Colour 1");
  for (const value of ["#102030", "#203040", "#304050"]) {
    fireEvent.input(colour, { target: { value } });
  }
  fireEvent.change(colour);
  expect(stops()).toEqual(["#304050", "#ffffff"]);
  editor.undo();
  expect(stops()).toEqual(["#808080", "#ffffff"]);
});

test("stops at eight colours", () => {
  setup();
  fireEvent.click(screen.getByRole("radio", { name: "Custom" }));
  const add = screen.getByRole<HTMLButtonElement>("button", { name: "Add colour" });
  for (let i = 0; i < 6; i++) {
    fireEvent.click(add);
  }
  expect(screen.getAllByLabelText(/^Colour \d$/)).toHaveLength(8);
  expect(add.disabled).toBe(true);
});

test("warns about colours too similar in brightness, without blocking them", () => {
  const editor = setup();
  expect(screen.queryByText(/too similar in brightness/)).toBeNull();
  fireEvent.click(screen.getByRole("radio", { name: "Custom" }));
  // Red and a grey of the same lightness.
  fireEvent.input(screen.getByLabelText("Colour 1"), { target: { value: "#ff0000" } });
  fireEvent.input(screen.getByLabelText("Colour 2"), { target: { value: "#7f7f7f" } });
  expect(screen.getByText(/too similar in brightness/)).toBeTruthy();
  expect(editor.recipe.value.texture.palette).toEqual({
    type: "custom",
    stops: ["#ff0000", "#7f7f7f"],
  });
});
