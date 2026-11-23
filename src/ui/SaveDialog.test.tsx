import { fireEvent, render, screen, within } from "@testing-library/preact";
import { afterEach, describe, expect, test, vi } from "vitest";
import { insertChunk, writeChunks } from "../core/png/chunks.ts";
import { encodeITxt } from "../core/png/itxt.ts";
import { defaultRecipe, type Asset, type Recipe } from "../core/recipe.ts";
import { Editor } from "../state/editor.ts";
import { embedProject } from "../state/projectFile.ts";
import { App } from "./App.tsx";
import type { ExportPng } from "./exportPng.ts";
import type { Renderer } from "./Preview.tsx";

vi.mock(import("./layers/importImage.ts"), async (original) => ({
  ...(await original()),
  importImage: vi.fn<() => Promise<Asset>>(() =>
    Promise.resolve({
      format: "gray",
      width: 2,
      height: 2,
      data: Uint8Array.of(0, 85, 170, 255),
    }),
  ),
}));

/** A 2 × 1 RGB PNG without a project. */
function plainPng(): Uint8Array<ArrayBuffer> {
  return writeChunks([
    { type: "IHDR", data: Uint8Array.of(0, 0, 0, 2, 0, 0, 0, 1, 8, 2, 0, 0, 0) },
    {
      type: "IDAT",
      data: Uint8Array.of(120, 156, 99, 248, 207, 0, 4, 255, 1, 7, 0, 1, 255),
    },
    { type: "IEND", data: new Uint8Array() },
  ]);
}

function setup(exportPng: ExportPng = () => Promise.resolve(new Blob([plainPng()]))) {
  const editor = new Editor(undefined, () => 7);
  const renderer: Renderer = {
    render: vi.fn<Renderer["render"]>(() => new Promise(() => {})),
  };
  const exporter = vi.fn<ExportPng>(exportPng);
  render(<App start="create" editor={editor} renderer={renderer} exportPng={exporter} />);
  return { editor, exporter };
}

const stubbed: string[] = [];

function stubNavigator(properties: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(properties)) {
    Object.defineProperty(navigator, key, { value, configurable: true });
    stubbed.push(key);
  }
}

afterEach(() => {
  for (const key of stubbed.splice(0)) {
    Reflect.deleteProperty(navigator, key);
  }
  vi.restoreAllMocks();
});

function openSave(): HTMLElement {
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  return screen.getByRole("dialog", { name: "Save PNG" });
}

function sizeNote(): HTMLElement {
  const note = document.querySelector<HTMLElement>("[data-width]");
  if (note === null) {
    throw new Error("No size note");
  }
  return note;
}

function pngFile(bytes: Uint8Array<ArrayBuffer>, name = "picture.png"): File {
  return new File([bytes], name, { type: "image/png" });
}

function choose(file: File): void {
  fireEvent.change(screen.getByLabelText("PNG file"), { target: { files: [file] } });
}

describe("the save dialog", () => {
  test("offers preset sizes at the picture's aspect and a custom width", () => {
    setup();
    const dialog = within(openSave());
    expect(dialog.getByRole<HTMLInputElement>("radio", { name: /1080p/ }).checked).toBe(true);
    expect(sizeNote().dataset).toMatchObject({ width: "1920", height: "1080" });
    expect(screen.queryByText(/run out of memory/)).toBeNull();
    expect(screen.getByText(/Some apps remove the project/)).toBeTruthy();

    fireEvent.click(dialog.getByRole("radio", { name: /A4 print/ }));
    expect(sizeNote().dataset).toMatchObject({ width: "3508", height: "1973" });

    fireEvent.click(dialog.getByRole("radio", { name: "Custom" }));
    const width = dialog.getByRole<HTMLInputElement>("spinbutton", { name: "Width" });
    fireEvent.change(width, { target: { value: "1000" } });
    expect(sizeNote().dataset).toMatchObject({ width: "1000", height: "563" });
    fireEvent.change(width, { target: { value: "99999" } });
    expect(Number(sizeNote().dataset["width"])).toBe(5461);
    expect(screen.getByText(/run out of memory/)).toBeTruthy();
  });

  test("downloads the exported PNG through a blob: link and reuses it", async () => {
    const created = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:test");
    const revoked = vi.spyOn(URL, "revokeObjectURL").mockReturnValue();
    const clicked: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clicked.push(`${this.download} ${this.href}`);
    });
    const { editor, exporter } = setup();
    editor.newSeed();
    openSave();
    fireEvent.click(screen.getByRole("button", { name: "Download" }));
    await vi.waitFor(() => {
      expect(clicked).toEqual(["eye-llusion-1920x1080.png blob:test"]);
    });
    expect(editor.modified.value).toBe(false);
    expect(exporter).toHaveBeenCalledWith(
      editor.recipe.value,
      { width: 1920, height: 1080 },
      expect.any(AbortSignal),
    );
    expect(created).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(60_000);
    expect(revoked).toHaveBeenCalledWith("blob:test");

    fireEvent.click(screen.getByRole("button", { name: "Download" }));
    await vi.waitFor(() => {
      expect(clicked).toHaveLength(2);
    });
    expect(exporter).toHaveBeenCalledOnce();
  });

  test("shares the PNG as a file where the browser can", async () => {
    const share = vi.fn<(data: ShareData) => Promise<void>>(() => Promise.resolve());
    stubNavigator({ share, canShare: () => true });
    setup();
    openSave();
    fireEvent.click(screen.getByRole("button", { name: "Share…" }));
    await vi.waitFor(() => {
      expect(share).toHaveBeenCalledOnce();
    });
    const files = share.mock.calls[0][0].files ?? [];
    expect(files.map((file) => [file.name, file.type])).toEqual([
      ["eye-llusion-1920x1080.png", "image/png"],
    ]);
  });

  test("says so when the PNG can't be made", async () => {
    setup(() => Promise.reject(new Error("out of memory")));
    openSave();
    expect(screen.queryByRole("button", { name: "Share…" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Download" }));
    await screen.findByText(/couldn't be made/);
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Download" }).disabled).toBe(
      false,
    );
  });

  test("closing mid-export aborts it and starts no download", async () => {
    const created = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:test");
    let finish: (blob: Blob) => void = () => undefined;
    const { editor, exporter } = setup(
      () =>
        new Promise<Blob>((resolve) => {
          finish = resolve;
        }),
    );
    editor.newSeed();
    openSave();
    fireEvent.click(screen.getByRole("button", { name: "Download" }));
    const signal = exporter.mock.calls[0][2];
    expect(signal?.aborted).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog", { name: "Save PNG" })).toBeNull();
    expect(signal?.aborted).toBe(true);

    finish(new Blob([plainPng()]));
    await vi.runAllTimersAsync();
    expect(created).not.toHaveBeenCalled();
    expect(editor.modified.value).toBe(true);
  });

  test("opens from the share dialog when the link can't carry the scene", () => {
    const { editor } = setup();
    editor.setTexture(
      { generator: { type: "tile", asset: "tile-1", divisions: 1, jitter: 0 } },
      { assets: { "tile-1": { format: "rgba", width: 1, height: 1, data: new Uint8Array(4) } } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Share" }));
    fireEvent.click(screen.getByRole("button", { name: "Download PNG" }));
    expect(screen.queryByRole("dialog", { name: "Share" })).toBeNull();
    expect(screen.getByRole("dialog", { name: "Save PNG" })).toBeTruthy();
  });
});

describe("opening a PNG", () => {
  function saved(): Recipe {
    return { ...defaultRecipe(), seed: 1234, view: { ...defaultRecipe().view, repeats: 10 } };
  }

  test("loads the embedded project as one undo step", async () => {
    const { editor } = setup();
    editor.setView({ repeats: 12 });
    choose(pngFile(await embedProject(plainPng(), saved())));
    await vi.waitFor(() => {
      expect(editor.recipe.value).toEqual(saved());
    });
    editor.undo();
    expect(editor.recipe.value.view.repeats).toBe(12);
  });

  test("opens a dropped PNG", async () => {
    const { editor } = setup();
    const shell = document.querySelector(".shell");
    if (shell === null) {
      throw new Error("No shell");
    }
    const file = pngFile(await embedProject(plainPng(), saved()));
    fireEvent.drop(shell, { dataTransfer: { files: [file], types: ["Files"] } });
    await vi.waitFor(() => {
      expect(editor.recipe.value).toEqual(saved());
    });
  });

  test("opens a PNG dropped on the gallery in Create", async () => {
    const editor = new Editor(undefined, () => 7);
    const renderer: Renderer = {
      render: vi.fn<Renderer["render"]>(() => new Promise(() => {})),
    };
    render(
      <App start="gallery" editor={editor} renderer={renderer} thumbnailRenderer={renderer} />,
    );
    const gallery = screen.getByRole("main");
    const file = pngFile(await embedProject(plainPng(), saved()));
    const transfer = { files: [file], types: ["Files"] };
    expect(fireEvent.dragOver(gallery, { dataTransfer: transfer })).toBe(false);
    expect(fireEvent.drop(gallery, { dataTransfer: transfer })).toBe(false);
    await vi.waitFor(() => {
      expect(editor.recipe.value).toEqual(saved());
    });
    expect(screen.getByRole("complementary", { name: "Controls" })).toBeTruthy();
    expect(editor.canUndo.value).toBe(false);
  });

  test("keeps a file dropped on the viewer from replacing the page", async () => {
    const { editor } = setup();
    fireEvent.click(screen.getByRole("button", { name: "View" }));
    const viewer = screen.getByRole("dialog", { name: "Viewer" });
    const file = pngFile(await embedProject(plainPng(), saved()));
    const transfer = { files: [file], types: ["Files"] };
    expect(fireEvent.dragOver(viewer, { dataTransfer: transfer })).toBe(false);
    expect(fireEvent.drop(viewer, { dataTransfer: transfer })).toBe(false);
    await vi.advanceTimersByTimeAsync(100);
    expect(editor.recipe.value).toEqual(defaultRecipe());
  });

  test("offers to add an image without a project as an image layer", async () => {
    const { editor } = setup();
    choose(pngFile(plainPng()));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("This image doesn't contain an Eye-llusion project");
    expect(editor.recipe.value).toEqual(defaultRecipe());

    fireEvent.click(screen.getByRole("button", { name: "Add as image layer" }));
    await vi.waitFor(() => {
      expect(editor.recipe.value.layers.map((layer) => layer.id)).toEqual(["sphere", "image-1"]);
    });
    const layer = editor.recipe.value.layers[1];
    expect(layer).toMatchObject({ kind: "image", name: "Image", asset: "image-1" });
    expect(editor.recipe.value.assets["image-1"].data).toEqual(Uint8Array.of(0, 85, 170, 255));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  test("reports a damaged project without offering an image layer", async () => {
    const { editor } = setup();
    const damaged = insertChunk(
      plainPng(),
      encodeITxt({ keyword: "eye-llusion-recipe", compressed: true, text: Uint8Array.of(1, 2) }),
    );
    choose(pngFile(damaged));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("project is damaged");
    expect(screen.queryByRole("button", { name: "Add as image layer" })).toBeNull();
    expect(editor.recipe.value).toEqual(defaultRecipe());
  });
});
