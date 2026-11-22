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
  for (const name of ["Dots", "Noise", "Marble", "Cells", "Shapes"]) {
    expect(screen.getByRole("radio", { name })).toBeTruthy();
  }
  expect(screen.getByRole<HTMLInputElement>("radio", { name: "Dots" }).checked).toBe(true);
  expect(screen.getByRole<HTMLInputElement>("radio", { name: "Mono" }).checked).toBe(true);
  expect(screen.getAllByRole("radio")).toHaveLength(11);
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
