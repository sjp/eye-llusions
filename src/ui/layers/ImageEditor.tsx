import { useEffect, useRef, useState } from "preact/hooks";
import { canReplaceAsset, newAssetId } from "../../core/assets.ts";
import { rasteriseImage } from "../../core/depth/image.ts";
import { RECIPE_LIMITS } from "../../core/parseRecipe.ts";
import { defaultRecipe, type ImageLayer, type Recipe } from "../../core/recipe.ts";
import { Segmented } from "../Segmented.tsx";
import { Slider } from "../Slider.tsx";
import { ImageImportError, importImage } from "./importImage.ts";
import type { LayerEditorProps } from "./kinds.ts";

type Fit = ImageLayer["fit"];

const FITS: readonly { value: Fit; label: string }[] = [
  { value: "contain", label: "Contain" },
  { value: "cover", label: "Cover" },
  { value: "stretch", label: "Stretch" },
];

const THUMBNAIL_WIDTH = 160;
const THUMBNAIL_MAX_HEIGHT = 120;
const LEVEL_GAP = 0.01;

const percent = (value: number): string => `${String(Math.round(value * 100))}%`;

function thumbnailSize(aspect: number): { width: number; height: number } {
  const height = Math.round(THUMBNAIL_WIDTH / aspect);
  return height <= THUMBNAIL_MAX_HEIGHT
    ? { width: THUMBNAIL_WIDTH, height: Math.max(1, height) }
    : {
        width: Math.max(1, Math.round(THUMBNAIL_MAX_HEIGHT * aspect)),
        height: THUMBNAIL_MAX_HEIGHT,
      };
}

/** The layer's processed depth at the canvas aspect, grey on a transparent background. */
function DepthThumbnail({ layer, recipe }: { layer: ImageLayer; recipe: Recipe }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const { width, height } = thumbnailSize(recipe.aspect);
  const { assets } = recipe;
  useEffect(() => {
    const context = ref.current?.getContext("2d");
    if (context === null || context === undefined) {
      return;
    }
    const target = {
      depth: new Float32Array(width * height),
      coverage: new Float32Array(width * height),
    };
    rasteriseImage(layer, { recipe: { ...defaultRecipe(), assets }, width, height, target });
    const image = new ImageData(width, height);
    for (let i = 0; i < target.depth.length; i++) {
      const grey = Math.round(target.depth[i] * 255);
      image.data.set([grey, grey, grey, Math.round(target.coverage[i] * 255)], i * 4);
    }
    context.putImageData(image, 0, 0);
  }, [layer, assets, width, height]);
  return (
    <canvas
      ref={ref}
      class="image-thumbnail"
      width={width}
      height={height}
      role="img"
      aria-label="Processed depth"
    />
  );
}

function hasFiles(event: DragEvent): boolean {
  return event.dataTransfer?.types.includes("Files") ?? false;
}

/** Picks, drops and replaces the layer's image, showing its processed depth. */
function ImageSource({ layer, recipe, change }: LayerEditorProps<ImageLayer>) {
  const input = useRef<HTMLInputElement>(null);
  const latest = useRef(recipe);
  latest.current = recipe;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [over, setOver] = useState(false);
  const missing = !Object.hasOwn(recipe.assets, layer.asset);

  const load = async (file: File): Promise<void> => {
    if (!canReplaceAsset(latest.current, layer.id)) {
      setError(
        `A picture can hold up to ${String(RECIPE_LIMITS.assets)} images. Delete an image layer to add another.`,
      );
      return;
    }
    setError(undefined);
    setBusy(true);
    try {
      const asset = await importImage(file);
      const id = newAssetId(latest.current, layer.id);
      change({ asset: id }, { assets: { [id]: asset } });
    } catch (problem) {
      setError(
        problem instanceof ImageImportError ? problem.message : "That image couldn't be opened.",
      );
    } finally {
      setBusy(false);
    }
  };

  let className = "image-drop";
  if (over) {
    className += " over";
  }
  return (
    <>
      <div
        class={className}
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
          <p class="panel-note">Image missing. Choose one to give this layer its depth.</p>
        ) : (
          <DepthThumbnail layer={layer} recipe={recipe} />
        )}
        <input
          ref={input}
          type="file"
          accept="image/*"
          class="visually-hidden"
          aria-label="Image file"
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
          {missing ? "Choose image" : "Replace image"}
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
    </>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label class="toggle">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => {
          onChange(event.currentTarget.checked);
        }}
      />
      <span>{label}</span>
    </label>
  );
}

export function ImageEditor(props: LayerEditorProps<ImageLayer>) {
  const { layer, change, commit } = props;
  const { levels } = layer;
  return (
    <>
      <ImageSource {...props} />
      <Segmented
        legend="Fit"
        options={FITS}
        value={layer.fit}
        onChange={(fit) => {
          change({ fit });
        }}
      />
      <Toggle
        label="Invert"
        checked={layer.invert}
        onChange={(invert) => {
          change({ invert });
        }}
      />
      <Slider
        label="Black point"
        min={0}
        max={1}
        step={0.01}
        value={levels.black}
        format={percent}
        onInput={(black) => {
          change(
            { levels: { ...levels, black: Math.min(black, levels.white - LEVEL_GAP) } },
            { coalesce: "levels.black" },
          );
        }}
        onCommit={commit}
      />
      <Slider
        label="White point"
        min={0}
        max={1}
        step={0.01}
        value={levels.white}
        format={percent}
        onInput={(white) => {
          change(
            { levels: { ...levels, white: Math.max(white, levels.black + LEVEL_GAP) } },
            { coalesce: "levels.white" },
          );
        }}
        onCommit={commit}
      />
      <Slider
        label="Blur"
        min={0}
        max={0.25}
        step={0.005}
        value={layer.blur}
        format={(value) => `${(value * 100).toFixed(1)}%`}
        onInput={(blur) => {
          change({ blur }, { coalesce: "blur" });
        }}
        onCommit={commit}
      />
      <Toggle
        label="Posterize"
        checked={layer.posterize !== null}
        onChange={(on) => {
          change({ posterize: on ? 6 : null });
        }}
      />
      {layer.posterize === null ? null : (
        <Slider
          label="Levels"
          min={2}
          max={64}
          step={1}
          value={layer.posterize}
          format={(value) => String(value)}
          onInput={(posterize) => {
            change({ posterize }, { coalesce: "posterize" });
          }}
          onCommit={commit}
        />
      )}
      <Toggle
        label="Silhouette"
        checked={layer.threshold !== null}
        onChange={(on) => {
          change({ threshold: on ? 0.5 : null });
        }}
      />
      {layer.threshold === null ? null : (
        <Slider
          label="Cut-off"
          min={0}
          max={1}
          step={0.01}
          value={layer.threshold}
          format={percent}
          onInput={(threshold) => {
            change({ threshold }, { coalesce: "threshold" });
          }}
          onCommit={commit}
        />
      )}
    </>
  );
}

export function ImageIcon() {
  return (
    <svg class="layer-icon" viewBox="0 0 24 24" aria-hidden="true">
      <rect
        x="3"
        y="5"
        width="18"
        height="14"
        rx="2"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
      />
      <path d="M5 17l5-6 4 4 2-2 3 4z" fill="currentColor" />
    </svg>
  );
}
