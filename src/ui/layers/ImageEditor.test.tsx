import { fireEvent, render, screen } from "@testing-library/preact";
import { beforeEach, expect, test, vi } from "vitest";
import { defaultRecipe, type Asset, type ImageLayer } from "../../core/recipe.ts";
import { Editor } from "../../state/editor.ts";
import { ImageImportError, importImage } from "./importImage.ts";
import { LayersPanel } from "./LayersPanel.tsx";

vi.mock(import("./importImage.ts"), async (original) => ({
  ...(await original()),
  importImage: vi.fn<typeof importImage>(),
}));

const pixel: Asset = { format: "gray", width: 2, height: 1, data: new Uint8Array([0, 255]) };

beforeEach(() => {
  vi.mocked(importImage).mockReset();
});

function setup() {
  const editor = new Editor({ ...defaultRecipe(), layers: [] });
  render(<LayersPanel editor={editor} />);
  fireEvent.click(screen.getByRole("button", { name: "Add image" }));
  const layer = (): ImageLayer => {
    const only = editor.recipe.value.layers.at(0);
    if (only?.kind !== "image") {
      throw new Error("expected one image layer");
    }
    return only;
  };
  const file = screen.getByLabelText<HTMLInputElement>("Image file");
  const choose = (): void => {
    fireEvent.change(file, { target: { files: [new File(["x"], "depth.png")] } });
  };
  return { editor, layer, choose };
}

test("a new image layer asks for an image", () => {
  const { layer, editor } = setup();
  expect(layer()).toMatchObject({ fit: "contain", invert: false, asset: "image-1" });
  expect(editor.recipe.value.assets).toEqual({});
  expect(screen.getByText(/Image missing/)).toBeTruthy();
  expect(screen.getByRole("button", { name: "Choose image" })).toBeTruthy();
});

test("choosing a file stores it as an asset in one undo step", async () => {
  vi.mocked(importImage).mockResolvedValue(pixel);
  const { editor, layer, choose } = setup();
  choose();
  await vi.waitFor(() => {
    expect(editor.recipe.value.assets).toEqual({ "image-1": pixel });
  });
  expect(layer().asset).toBe("image-1");
  expect(await screen.findByRole("button", { name: "Replace image" })).toBeTruthy();
  expect(screen.getByRole("img", { name: "Processed depth" })).toBeTruthy();

  vi.mocked(importImage).mockResolvedValue({ ...pixel });
  choose();
  await vi.waitFor(() => {
    expect(layer().asset).toBe("image-2");
  });
  expect(Object.keys(editor.recipe.value.assets)).toEqual(["image-2"]);
  editor.undo();
  await vi.waitFor(() => {
    expect(Object.keys(editor.recipe.value.assets)).toEqual(["image-1"]);
  });
});

test("a file that can't be read shows its message", async () => {
  vi.mocked(importImage).mockRejectedValue(new ImageImportError("Not an image."));
  const { editor, choose } = setup();
  choose();
  expect((await screen.findByRole("alert")).textContent).toBe("Not an image.");
  expect(editor.recipe.value.assets).toEqual({});
});

test("invert, posterize and silhouette edit the layer", () => {
  const { layer } = setup();
  fireEvent.click(screen.getByRole("checkbox", { name: "Invert" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "Posterize" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "Silhouette" }));
  fireEvent.click(screen.getByRole("radio", { name: "Cover" }));
  expect(layer()).toMatchObject({ invert: true, posterize: 6, threshold: 0.5, fit: "cover" });
  fireEvent.input(screen.getByRole("slider", { name: "Cut-off" }), { target: { value: "0.3" } });
  expect(layer().threshold).toBe(0.3);
});

test("black and white points never cross", () => {
  const { layer } = setup();
  fireEvent.input(screen.getByRole("slider", { name: "White point" }), {
    target: { value: "0.4" },
  });
  fireEvent.input(screen.getByRole("slider", { name: "Black point" }), {
    target: { value: "0.9" },
  });
  expect(layer().levels.white).toBe(0.4);
  expect(layer().levels.black).toBeCloseTo(0.39, 5);
});
