import { fireEvent, render, screen } from "@testing-library/preact";
import { beforeEach, expect, test, vi } from "vitest";
import { RECIPE_LIMITS } from "../../core/parseRecipe.ts";
import { defaultRecipe, type Asset, type Recipe } from "../../core/recipe.ts";
import { Editor } from "../../state/editor.ts";
import { importImage } from "../layers/importImage.ts";
import { TexturePanel } from "./TexturePanel.tsx";

vi.mock(import("../layers/importImage.ts"), async (original) => ({
  ...(await original()),
  importImage: vi.fn<typeof importImage>(),
}));

function rgba(width: number, height: number, pixel: (x: number) => number): Asset {
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const value = pixel(i % width);
    data.set([value, value, value, 255], i * 4);
  }
  return { format: "rgba", width, height, data };
}

/** Pseudo-random grey columns: plenty of detail. */
const detailed = rgba(32, 32, (x) => (x * 97) % 256);
const flat = rgba(32, 32, () => 128);

beforeEach(() => {
  vi.mocked(importImage).mockReset();
});

function setup(recipe: Recipe = defaultRecipe()) {
  const editor = new Editor(recipe);
  render(<TexturePanel editor={editor} />);
  const choose = (): void => {
    fireEvent.change(screen.getByLabelText("Tile image"), {
      target: { files: [new File(["x"], "tile.png")] },
    });
  };
  const generator = () => editor.recipe.value.texture.generator;
  return { editor, choose, generator };
}

test("picking the tile pattern asks for an image and hides the palette", () => {
  const { generator, editor } = setup();
  fireEvent.click(screen.getByRole("radio", { name: "Tile" }));
  expect(generator()).toEqual({ type: "tile", asset: "tile-1", divisions: 1, jitter: 0 });
  expect(editor.recipe.value.assets).toEqual({});
  expect(screen.getByText(/Tile missing/)).toBeTruthy();
  expect(screen.getByRole("button", { name: "Choose tile" })).toBeTruthy();
  expect(screen.queryByRole("radio", { name: "Mono" })).toBeNull();
  expect(screen.queryByRole("slider", { name: "Scale" })).toBeNull();
});

test("choosing a tile stores it in colour as one undo step", async () => {
  vi.mocked(importImage).mockResolvedValue(detailed);
  const { editor, choose, generator } = setup();
  fireEvent.click(screen.getByRole("radio", { name: "Tile" }));
  choose();
  await vi.waitFor(() => {
    expect(editor.recipe.value.assets).toEqual({ "tile-1": detailed });
  });
  expect(vi.mocked(importImage).mock.calls[0][1]).toMatchObject({ format: "rgba" });
  expect(await screen.findByRole("button", { name: "Replace tile" })).toBeTruthy();
  expect(screen.queryByText(/Tile missing/)).toBeNull();

  vi.mocked(importImage).mockResolvedValue({ ...detailed });
  choose();
  await vi.waitFor(() => {
    expect(generator()).toMatchObject({ asset: "tile-2" });
  });
  expect(Object.keys(editor.recipe.value.assets)).toEqual(["tile-2"]);
  editor.undo();
  await vi.waitFor(() => {
    expect(Object.keys(editor.recipe.value.assets)).toEqual(["tile-1"]);
  });
});

test("a flat tile warns until jitter is added", async () => {
  vi.mocked(importImage).mockResolvedValue(flat);
  const { choose, generator } = setup();
  fireEvent.click(screen.getByRole("radio", { name: "Tile" }));
  choose();
  expect(await screen.findByText(/Large parts of this tile are flat/)).toBeTruthy();
  const jitter = screen.getByRole("slider", { name: "Jitter" });
  fireEvent.input(jitter, { target: { value: "0.4" } });
  fireEvent.change(jitter);
  expect(generator()).toMatchObject({ jitter: 0.4 });
  expect(screen.queryByText(/Large parts of this tile are flat/)).toBeNull();
});

test("a detailed tile doesn't warn", async () => {
  vi.mocked(importImage).mockResolvedValue(detailed);
  const { choose } = setup();
  fireEvent.click(screen.getByRole("radio", { name: "Tile" }));
  choose();
  await screen.findByRole("button", { name: "Replace tile" });
  expect(screen.queryByText(/flat/)).toBeNull();
});

test("tile width picks how many copies fit a strip", () => {
  const { generator } = setup();
  fireEvent.click(screen.getByRole("radio", { name: "Tile" }));
  fireEvent.click(screen.getByRole("radio", { name: "1/3" }));
  expect(generator()).toMatchObject({ divisions: 3 });
});

test("a tile from a link without its image shows the missing prompt", () => {
  const recipe: Recipe = {
    ...defaultRecipe(),
    texture: {
      ...defaultRecipe().texture,
      generator: { type: "tile", asset: "tile-7", divisions: 2, jitter: 0 },
    },
  };
  setup(recipe);
  expect(screen.getByRole<HTMLInputElement>("radio", { name: "Tile" }).checked).toBe(true);
  expect(screen.getByText(/Tile missing/)).toBeTruthy();
});

test("refuses a tile when the picture holds too many images", async () => {
  const pixel: Asset = { format: "gray", width: 1, height: 1, data: new Uint8Array(1) };
  const base = defaultRecipe();
  const recipe: Recipe = {
    ...base,
    layers: Array.from({ length: RECIPE_LIMITS.assets }, (_, i) => ({
      kind: "image",
      id: `image-${String(i)}`,
      name: "Image",
      visible: true,
      blend: "max",
      depth: 1,
      asset: `a${String(i)}`,
      fit: "contain",
      invert: false,
      levels: { black: 0, white: 1 },
      blur: 0,
      posterize: null,
      threshold: null,
    })),
    assets: Object.fromEntries(
      Array.from({ length: RECIPE_LIMITS.assets }, (_, i) => [`a${String(i)}`, pixel]),
    ),
  };
  const { choose } = setup(recipe);
  fireEvent.click(screen.getByRole("radio", { name: "Tile" }));
  choose();
  expect((await screen.findByRole("alert")).textContent).toMatch(/up to 16 images/);
  expect(importImage).not.toHaveBeenCalled();
});
