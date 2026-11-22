import { useEffect, useId, useRef } from "preact/hooks";
import type { Palette, Recipe, TextureGenerator, TextureSpec } from "../../core/recipe.ts";
import { freeAssetId } from "../../core/assets.ts";
import { PALETTE_PRESETS, paletteStops } from "../../core/texture/palette.ts";
import { scaleLimits } from "../../core/texture/scale.ts";
import type { Editor } from "../../state/editor.ts";
import { Panel } from "../Panel.tsx";
import { Slider } from "../Slider.tsx";
import { ContrastWarning, PaletteEditor } from "./PaletteEditor.tsx";
import { paletteSwatch, textureSwatch } from "./swatches.ts";
import { TileSettings } from "./TileSettings.tsx";

/** Each generator with the parameters it starts with. */
const GENERATORS: readonly { generator: TextureGenerator; label: string }[] = [
  { generator: { type: "randomDots", density: 0.5 }, label: "Dots" },
  { generator: { type: "colourNoise" }, label: "Noise" },
  { generator: { type: "fractalNoise", octaves: 4 }, label: "Marble" },
  { generator: { type: "cells", shading: 0.4 }, label: "Cells" },
  { generator: { type: "scatteredShapes", density: 0.8 }, label: "Shapes" },
  // The asset ID is filled in with a free one when the tile is picked.
  { generator: { type: "tile", asset: "tile", divisions: 1, jitter: 0 }, label: "Tile" },
];

const SWATCH_WIDTH = 96;
const SWATCH_HEIGHT = 48;
const STRIP_WIDTH = 64;
const STRIP_HEIGHT = 12;

function SwatchCanvas({
  draw,
  width,
  height,
  class: className,
  deps,
}: {
  draw: () => ImageData;
  width: number;
  height: number;
  class: string;
  deps: readonly unknown[];
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const context = ref.current?.getContext("2d");
    context?.putImageData(draw(), 0, 0);
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- `draw` is new on every render
  }, deps);
  return <canvas ref={ref} class={className} width={width} height={height} aria-hidden="true" />;
}

function GeneratorPicker({ recipe, editor }: { recipe: Recipe; editor: Editor }) {
  const name = useId();
  const { texture, seed, aspect, view } = recipe;
  return (
    <fieldset class="choice-picker">
      <legend>Pattern</legend>
      <div class="choice-options">
        {GENERATORS.map(({ generator: preset, label }) => {
          const initial: TextureGenerator =
            preset.type === "tile" ? { ...preset, asset: freeAssetId(recipe, "tile") } : preset;
          const selected = initial.type === texture.generator.type;
          const swatch: TextureSpec = {
            ...texture,
            generator: selected ? texture.generator : initial,
          };
          return (
            <label key={initial.type}>
              <input
                type="radio"
                name={name}
                value={initial.type}
                checked={selected}
                onChange={() => {
                  editor.setTexture({ generator: initial });
                }}
              />
              <SwatchCanvas
                class="texture-swatch"
                width={SWATCH_WIDTH}
                height={SWATCH_HEIGHT}
                draw={() => textureSwatch(swatch, recipe, SWATCH_WIDTH, SWATCH_HEIGHT)}
                deps={[
                  selected ? swatch.generator : initial.type,
                  recipe.assets,
                  texture.palette,
                  texture.scale,
                  texture.seed,
                  seed,
                  aspect,
                  view.repeats,
                ]}
              />
              <span>{label}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

const PRESET_LABELS: Readonly<Record<string, string>> = {
  mono: "Mono",
  neon: "Neon",
  ocean: "Ocean",
  autumn: "Autumn",
  pastel: "Pastel",
  forest: "Forest",
};

function PalettePicker({ palette, editor }: { palette: Palette; editor: Editor }) {
  const name = useId();
  const custom: Palette & { type: "custom" } = {
    type: "custom",
    stops: [...paletteStops(palette)],
  };
  return (
    <fieldset class="choice-picker">
      <legend>Palette</legend>
      <div class="choice-options">
        {Object.keys(PALETTE_PRESETS).map((id) => {
          const preset: Palette = { type: "preset", id };
          return (
            <label key={id}>
              <input
                type="radio"
                name={name}
                value={id}
                checked={palette.type === "preset" && palette.id === id}
                onChange={() => {
                  editor.setTexture({ palette: preset });
                }}
              />
              <SwatchCanvas
                class="palette-swatch"
                width={STRIP_WIDTH}
                height={STRIP_HEIGHT}
                draw={() => paletteSwatch(preset, STRIP_WIDTH, STRIP_HEIGHT)}
                deps={[id]}
              />
              <span>{PRESET_LABELS[id] ?? id}</span>
            </label>
          );
        })}
        <label>
          <input
            type="radio"
            name={name}
            value="custom"
            checked={palette.type === "custom"}
            onChange={() => {
              // Custom colours start from the palette in use.
              editor.setTexture({ palette: custom });
            }}
          />
          <SwatchCanvas
            class="palette-swatch"
            width={STRIP_WIDTH}
            height={STRIP_HEIGHT}
            draw={() => paletteSwatch(custom, STRIP_WIDTH, STRIP_HEIGHT)}
            deps={[custom.stops.join(",")]}
          />
          <span>Custom</span>
        </label>
      </div>
    </fieldset>
  );
}

const percent = (value: number): string => `${String(Math.round(value * 100))}%`;

function GeneratorSettings({ generator, editor }: { generator: TextureGenerator; editor: Editor }) {
  const slider = (
    label: string,
    range: [min: number, max: number, step: number],
    value: number,
    format: (value: number) => string,
    update: (value: number) => TextureGenerator,
  ) => (
    <Slider
      label={label}
      min={range[0]}
      max={range[1]}
      step={range[2]}
      value={value}
      format={format}
      onInput={(next) => {
        editor.setTexture({ generator: update(next) }, { coalesce: `texture.${label}` });
      }}
      onCommit={() => {
        editor.endEdit();
      }}
    />
  );
  switch (generator.type) {
    case "randomDots":
      return slider("Dot density", [0.05, 0.95, 0.01], generator.density, percent, (density) => ({
        ...generator,
        density,
      }));
    case "colourNoise":
    case "tile":
      return null;
    case "fractalNoise":
      return slider(
        "Detail",
        [1, 6, 1],
        generator.octaves,
        (octaves) => String(Math.round(octaves)),
        (octaves) => ({ ...generator, octaves }),
      );
    case "cells":
      return slider("Edge shading", [0, 1, 0.01], generator.shading, percent, (shading) => ({
        ...generator,
        shading,
      }));
    case "scatteredShapes":
      return slider("Shape density", [0.1, 1, 0.01], generator.density, percent, (density) => ({
        ...generator,
        density,
      }));
    default:
      return null;
  }
}

function ScaleSlider({ recipe, editor }: { recipe: Recipe; editor: Editor }) {
  const { texture, aspect, view } = recipe;
  const { min, max } = scaleLimits(texture.generator.type, aspect, view.repeats);
  // Logarithmic, so each step changes the feature size by the same factor.
  return (
    <Slider
      label="Scale"
      min={Math.log2(min)}
      max={Math.log2(max)}
      step={0.01}
      value={Math.log2(texture.scale)}
      format={(value) => `${(2 ** value).toFixed(2)}×`}
      onInput={(value) => {
        editor.setTexture({ scale: 2 ** value }, { coalesce: "texture.scale" });
      }}
      onCommit={() => {
        editor.endEdit();
      }}
    />
  );
}

export function TexturePanel({ editor }: { editor: Editor }) {
  const recipe = editor.recipe.value;
  const { generator, palette } = recipe.texture;
  return (
    <Panel title="Texture">
      <GeneratorPicker recipe={recipe} editor={editor} />
      {generator.type === "tile" ? (
        // Tiles keep their own colours and are sized to the strip.
        <TileSettings recipe={recipe} generator={generator} editor={editor} />
      ) : (
        <>
          <GeneratorSettings generator={generator} editor={editor} />
          <ScaleSlider recipe={recipe} editor={editor} />
          <PalettePicker palette={palette} editor={editor} />
          {palette.type === "custom" ? (
            <PaletteEditor stops={palette.stops} editor={editor} />
          ) : null}
          <ContrastWarning palette={palette} />
        </>
      )}
      <button
        type="button"
        class="button"
        onClick={() => {
          editor.newTextureSeed();
        }}
      >
        New texture seed
      </button>
    </Panel>
  );
}
