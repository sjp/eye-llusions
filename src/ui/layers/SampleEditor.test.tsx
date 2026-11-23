import { fireEvent, render, screen } from "@testing-library/preact";
import { afterEach, expect, test, vi } from "vitest";
import { FIGURES } from "../../core/depth/figure.ts";
import { defaultRecipe, type SampleLayer } from "../../core/recipe.ts";
import { Editor } from "../../state/editor.ts";
import { LayersPanel } from "./LayersPanel.tsx";

function setup() {
  const editor = new Editor(defaultRecipe());
  render(<LayersPanel editor={editor} />);
  const layer = (): SampleLayer => {
    const only = editor.recipe.value.layers.at(0);
    if (only?.kind !== "sample") {
      throw new Error("expected one shape layer");
    }
    return only;
  };
  return { editor, layer };
}

afterEach(() => {
  vi.restoreAllMocks();
});

function slide(name: string, value: number): void {
  const slider = screen.getByRole("slider", { name });
  fireEvent.input(slider, { target: { value: String(value) } });
  fireEvent.change(slider);
}

test("offers every shape and figure, with the layer's shape checked", () => {
  setup();
  const names = ["Sphere", "Ripples", "Pyramid", "Torus", "Spiral stairs"];
  for (const name of [...names, ...FIGURES.map(({ label }) => label)]) {
    expect(screen.getByRole("radio", { name })).toBeTruthy();
  }
  expect(screen.getByRole<HTMLInputElement>("radio", { name: "Sphere" }).checked).toBe(true);
  // A sphere has no settings of its own.
  expect(screen.queryByRole("slider", { name: "Rings" })).toBeNull();
});

test.each([
  { shape: "Ripples", settings: [["Rings", 7, { rings: 7 }]] },
  { shape: "Pyramid", settings: [["Sides", 6, { sides: 6 }]] },
  { shape: "Torus", settings: [["Thickness", 0.6, { thickness: 0.6 }]] },
  {
    shape: "Spiral stairs",
    settings: [
      ["Steps", 24, { steps: 24 }],
      ["Turns", 3.5, { turns: 3.5 }],
    ],
  },
] as const)("$shape has its own settings, each an undo step", ({ shape, settings }) => {
  const { editor, layer } = setup();
  fireEvent.click(screen.getByRole("radio", { name: shape }));
  const picked = layer().shape;
  for (const [name, value, expected] of settings) {
    slide(name, value);
    expect(layer().shape).toMatchObject(expected);
  }
  for (const _ of settings) {
    editor.undo();
  }
  expect(layer().shape).toEqual(picked);
  editor.undo();
  expect(layer().shape).toEqual({ type: "sphere" });
});

test("a figure is picked by its picture and has no settings", () => {
  const { layer } = setup();
  const [figure] = FIGURES;
  fireEvent.click(screen.getByRole("radio", { name: figure.label }));
  expect(layer().shape).toEqual({ type: "figure", figure: figure.id });
  expect(screen.getByRole<HTMLInputElement>("radio", { name: figure.label }).checked).toBe(true);
  expect(screen.queryAllByRole("slider", { name: /Rings|Sides|Thickness|Steps|Turns/ })).toEqual(
    [],
  );
});

test("moves and sizes the shape, each slider drag one undo step", () => {
  const { editor, layer } = setup();
  const before = layer();
  const field = screen.getByRole("slider", { name: "X position" });
  fireEvent.input(field, { target: { value: "0.3" } });
  fireEvent.input(field, { target: { value: "0.2" } });
  fireEvent.change(field);
  slide("Y position", 0.7);
  slide("Size", 1.5);
  expect(layer()).toMatchObject({ center: { x: 0.2, y: 0.7 }, size: 1.5 });
  editor.undo();
  editor.undo();
  expect(layer().center).toEqual({ x: 0.2, y: before.center.y });
  editor.undo();
  expect(layer()).toEqual(before);
});

test("draws each procedural shape's thumbnail as a grey depth map, brightest nearest", () => {
  const drawn = new Map<string, ImageData>();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function (
    this: HTMLCanvasElement,
  ) {
    const label = this.closest("label")?.textContent ?? "";
    return {
      putImageData: (image: ImageData) => {
        drawn.set(label, image);
      },
    } as unknown as CanvasRenderingContext2D;
  });
  setup();
  expect(new Set(drawn.keys())).toEqual(
    new Set(["Sphere", "Ripples", "Pyramid", "Torus", "Spiral stairs"]),
  );
  const sphere = drawn.get("Sphere");
  if (sphere === undefined) {
    throw new Error("no sphere thumbnail");
  }
  const at = (x: number, y: number) => sphere.data.slice((y * 64 + x) * 4, (y * 64 + x) * 4 + 4);
  const [r, g, b, a] = at(32, 32);
  expect([g, b, a]).toEqual([r, r, 255]);
  expect(r).toBeGreaterThan(200);
  expect(Array.from(at(0, 0))).toEqual([0, 0, 0, 255]);
});
