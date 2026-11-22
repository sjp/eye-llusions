import { useEffect, useId, useRef } from "preact/hooks";
import { rasteriseSample } from "../../core/depth/sample.ts";
import { defaultRecipe, type SampleLayer, type SampleShape } from "../../core/recipe.ts";
import { Slider } from "../Slider.tsx";
import type { LayerEditorProps } from "./kinds.ts";

type ShapeType = SampleShape["type"];

/** Each shape with the parameters a new one starts with. */
const SHAPES: readonly { shape: SampleShape; label: string }[] = [
  { shape: { type: "sphere" }, label: "Sphere" },
  { shape: { type: "ripples", rings: 4 }, label: "Ripples" },
  { shape: { type: "pyramid", sides: 4 }, label: "Pyramid" },
  { shape: { type: "torus", thickness: 0.4 }, label: "Torus" },
  { shape: { type: "spiralStairs", steps: 16, turns: 2 }, label: "Spiral stairs" },
];

const THUMBNAIL_SIZE = 64;
const thumbnails = new Map<ShapeType, ImageData>();

/** A grey depth render of the shape, cached per shape type. */
function thumbnail(shape: SampleShape): ImageData {
  const cached = thumbnails.get(shape.type);
  if (cached !== undefined) {
    return cached;
  }
  const size = THUMBNAIL_SIZE;
  const target = { depth: new Float32Array(size * size), coverage: new Float32Array(size * size) };
  const layer: SampleLayer = {
    kind: "sample",
    id: "thumbnail",
    name: "",
    visible: true,
    blend: "max",
    depth: 1,
    shape,
    center: { x: 0.5, y: 0.5 },
    size: 0.94,
  };
  rasteriseSample(layer, { recipe: defaultRecipe(), width: size, height: size, target });
  const image = new ImageData(size, size);
  for (let i = 0; i < target.depth.length; i++) {
    const grey = Math.round(255 * (0.15 + 0.85 * target.depth[i]) * target.coverage[i]);
    image.data.set([grey, grey, grey, 255], i * 4);
  }
  thumbnails.set(shape.type, image);
  return image;
}

function ShapeThumbnail({ shape }: { shape: SampleShape }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    ref.current?.getContext("2d")?.putImageData(thumbnail(shape), 0, 0);
  }, [shape]);
  return (
    <canvas
      ref={ref}
      class="shape-thumbnail"
      width={THUMBNAIL_SIZE}
      height={THUMBNAIL_SIZE}
      aria-hidden="true"
    />
  );
}

function ShapePicker({
  value,
  onChange,
}: {
  value: ShapeType;
  onChange: (shape: SampleShape) => void;
}) {
  const name = useId();
  return (
    <fieldset class="choice-picker">
      <legend>Shape</legend>
      <div class="choice-options">
        {SHAPES.map(({ shape, label }) => (
          <label key={shape.type}>
            <input
              type="radio"
              name={name}
              value={shape.type}
              checked={shape.type === value}
              onChange={() => {
                onChange(shape);
              }}
            />
            <ShapeThumbnail shape={shape} />
            <span>{label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

const whole = (value: number): string => String(Math.round(value));
const percent = (value: number): string => `${String(Math.round(value * 100))}%`;

function ShapeSettings({ layer, change, commit }: LayerEditorProps<SampleLayer>) {
  const { shape } = layer;
  const slider = (
    key: string,
    label: string,
    range: [min: number, max: number, step: number],
    value: number,
    format: (value: number) => string,
    update: (value: number) => SampleShape,
  ) => (
    <Slider
      label={label}
      min={range[0]}
      max={range[1]}
      step={range[2]}
      value={value}
      format={format}
      onInput={(next) => {
        change({ shape: update(next) }, { coalesce: `shape.${key}` });
      }}
      onCommit={commit}
    />
  );
  switch (shape.type) {
    case "sphere":
      return null;
    case "ripples":
      return slider("rings", "Rings", [1, 32, 1], shape.rings, whole, (rings) => ({
        ...shape,
        rings,
      }));
    case "pyramid":
      return slider("sides", "Sides", [3, 12, 1], shape.sides, whole, (sides) => ({
        ...shape,
        sides,
      }));
    case "torus":
      return slider(
        "thickness",
        "Thickness",
        [0.05, 0.95, 0.01],
        shape.thickness,
        percent,
        (thickness) => ({ ...shape, thickness }),
      );
    case "spiralStairs":
      return (
        <>
          {slider("steps", "Steps", [2, 64, 1], shape.steps, whole, (steps) => ({
            ...shape,
            steps,
          }))}
          {slider(
            "turns",
            "Turns",
            [0.25, 8, 0.25],
            shape.turns,
            (turns) => String(turns),
            (turns) => ({ ...shape, turns }),
          )}
        </>
      );
    default:
      return null;
  }
}

export function SampleEditor(props: LayerEditorProps<SampleLayer>) {
  const { layer, change, commit } = props;
  return (
    <>
      <ShapePicker
        value={layer.shape.type}
        onChange={(shape) => {
          change({ shape });
        }}
      />
      <ShapeSettings {...props} />
      <Slider
        label="X position"
        min={0}
        max={1}
        step={0.01}
        value={layer.center.x}
        format={percent}
        onInput={(x) => {
          change({ center: { ...layer.center, x } }, { coalesce: "center.x" });
        }}
        onCommit={commit}
      />
      <Slider
        label="Y position"
        min={0}
        max={1}
        step={0.01}
        value={layer.center.y}
        format={percent}
        onInput={(y) => {
          change({ center: { ...layer.center, y } }, { coalesce: "center.y" });
        }}
        onCommit={commit}
      />
      <Slider
        label="Size"
        min={0.05}
        max={2}
        step={0.01}
        value={layer.size}
        format={percent}
        onInput={(size) => {
          change({ size }, { coalesce: "size" });
        }}
        onCommit={commit}
      />
    </>
  );
}

export function SampleIcon() {
  return (
    <svg class="layer-icon" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="2" />
      <circle cx="9.5" cy="9.5" r="2.5" fill="currentColor" />
    </svg>
  );
}
