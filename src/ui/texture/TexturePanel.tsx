import { useEffect, useId, useRef } from "preact/hooks";
import type { Palette, Recipe, TextureGenerator, TextureSpec } from "../../core/recipe.ts";
import { PALETTE_PRESETS } from "../../core/texture/palette.ts";
import { scaleLimits } from "../../core/texture/scale.ts";
import type { Editor } from "../../state/editor.ts";
import { Panel } from "../Panel.tsx";
import { Slider } from "../Slider.tsx";
import { paletteSwatch, textureSwatch } from "./swatches.ts";

/** Each generator with the parameters it starts with. */
const GENERATORS: readonly { generator: TextureGenerator; label: string }[] = [
  { generator: { type: "randomDots", density: 0.5 }, label: "Dots" },
  { generator: { type: "colourNoise" }, label: "Noise" },
  { generator: { type: "fractalNoise", octaves: 4 }, label: "Marble" },
  { generator: { type: "cells", shading: 0.4 }, label: "Cells" },
  { generator: { type: "scatteredShapes", density: 0.8 }, label: "Shapes" },
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
        {GENERATORS.map(({ generator: initial, label }) => {
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
                  swatch.generator,
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
  return (
    <Panel title="Texture">
      <GeneratorPicker recipe={recipe} editor={editor} />
      <GeneratorSettings generator={recipe.texture.generator} editor={editor} />
      <ScaleSlider recipe={recipe} editor={editor} />
      <PalettePicker palette={recipe.texture.palette} editor={editor} />
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
