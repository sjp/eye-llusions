import { useMemo, useRef, useState } from "preact/hooks";
import { canReplaceTile, missingAssets, newTileId } from "../../core/assets.ts";
import { RECIPE_LIMITS } from "../../core/parseRecipe.ts";
import type { Asset, Recipe, TextureGenerator } from "../../core/recipe.ts";
import { FLAT_WARNING, flatFraction } from "../../core/texture/tile.ts";
import type { Editor } from "../../state/editor.ts";
import { ImageImportError, importImage } from "../layers/importImage.ts";
import { Segmented } from "../Segmented.tsx";
import { Slider } from "../Slider.tsx";

type Tile = TextureGenerator & { type: "tile" };

/** Longest side of a stored tile, in pixels: strips are rarely wider. */
const MAX_TILE_SIDE = 512;

/** Jitter from which a flat tile is taken to have enough detail. */
const ENOUGH_JITTER = 0.25;

const WIDTHS = [
  { value: "1", label: "Strip" },
  { value: "2", label: "1/2" },
  { value: "3", label: "1/3" },
  { value: "4", label: "1/4" },
] as const;

type Width = (typeof WIDTHS)[number]["value"];

function isWidth(value: string): value is Width {
  return WIDTHS.some((option) => option.value === value);
}

function hasFiles(event: DragEvent): boolean {
  return event.dataTransfer?.types.includes("Files") ?? false;
}

function FlatWarning({ asset, jitter }: { asset: Asset; jitter: number }) {
  const flat = useMemo(() => flatFraction(asset), [asset]);
  return flat > FLAT_WARNING && jitter < ENOUGH_JITTER ? (
    <p class="panel-note warning" role="status">
      Large parts of this tile are flat, which can be hard to fuse. Add some jitter to give them
      detail.
    </p>
  ) : null;
}

/** Picks or drops the tile image and sets how it repeats. */
export function TileSettings({
  recipe,
  generator,
  editor,
}: {
  recipe: Recipe;
  generator: Tile;
  editor: Editor;
}) {
  const input = useRef<HTMLInputElement>(null);
  const latest = useRef(recipe);
  latest.current = recipe;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [over, setOver] = useState(false);
  const missing = missingAssets(recipe).includes(generator.asset);
  const width = String(generator.divisions);

  const load = async (file: File): Promise<void> => {
    if (!canReplaceTile(latest.current)) {
      setError(
        `A picture can hold up to ${String(RECIPE_LIMITS.assets)} images. Delete an image layer to add a tile.`,
      );
      return;
    }
    setError(undefined);
    setBusy(true);
    try {
      const asset = await importImage(file, { format: "rgba", maxSide: MAX_TILE_SIDE });
      const current = latest.current;
      const id = newTileId(current);
      const base =
        current.texture.generator.type === "tile" ? current.texture.generator : generator;
      editor.setTexture({ generator: { ...base, asset: id } }, { assets: { [id]: asset } });
    } catch (problem) {
      setError(
        problem instanceof ImageImportError ? problem.message : "That image couldn't be opened.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div
        class={over ? "image-drop over" : "image-drop"}
        onDragOver={(event) => {
          if (hasFiles(event)) {
            event.preventDefault();
            setOver(true);
          }
        }}
        onDragLeave={() => {
          setOver(false);
        }}
        onDrop={(event) => {
          event.preventDefault();
          setOver(false);
          const file = event.dataTransfer?.files[0];
          if (file !== undefined) {
            void load(file);
          }
        }}
      >
        {missing ? (
          <p class="panel-note">Tile missing. Choose one; random dots show until then.</p>
        ) : (
          <p class="panel-note">Each strip repeats the tile in its own colours.</p>
        )}
        <input
          ref={input}
          type="file"
          accept="image/*"
          class="visually-hidden"
          aria-label="Tile image"
          tabIndex={-1}
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = "";
            if (file !== undefined) {
              void load(file);
            }
          }}
        />
        <button
          type="button"
          class="button"
          disabled={busy}
          onClick={() => {
            input.current?.click();
          }}
        >
          {missing ? "Choose tile" : "Replace tile"}
        </button>
      </div>
      {busy ? (
        <p class="panel-note" role="status">
          Opening image…
        </p>
      ) : null}
      {error === undefined ? null : (
        <p class="panel-note error" role="alert">
          {error}
        </p>
      )}
      {missing ? null : (
        <FlatWarning asset={recipe.assets[generator.asset]} jitter={generator.jitter} />
      )}
      <Segmented
        legend="Tile width"
        options={WIDTHS}
        value={isWidth(width) ? width : "1"}
        onChange={(value) => {
          editor.setTexture({ generator: { ...generator, divisions: Number(value) } });
        }}
      />
      <Slider
        label="Jitter"
        min={0}
        max={1}
        step={0.01}
        value={generator.jitter}
        format={(value) => `${String(Math.round(value * 100))}%`}
        onInput={(jitter) => {
          editor.setTexture(
            { generator: { ...generator, jitter } },
            { coalesce: "texture.Jitter" },
          );
        }}
        onCommit={() => {
          editor.endEdit();
        }}
      />
    </>
  );
}
