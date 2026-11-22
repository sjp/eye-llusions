import { useContext } from "preact/hooks";
import type { Brush, DrawingLayer } from "../../core/recipe.ts";
import type { LayerEditorProps } from "../layers/kinds.ts";
import { Segmented } from "../Segmented.tsx";
import { Slider } from "../Slider.tsx";
import { DrawingToolsContext } from "./tools.ts";

type BrushMode = Brush["mode"];

const MODES: readonly { value: BrushMode; label: string }[] = [
  { value: "set", label: "Set" },
  { value: "raise", label: "Raise" },
  { value: "lower", label: "Lower" },
  { value: "smooth", label: "Smooth" },
];

const percent = (value: number): string => `${String(Math.round(value * 100))}%`;

/** Brush settings for drawing on the preview, and clearing the layer. */
export function DrawingEditor({ layer, change }: LayerEditorProps<DrawingLayer>) {
  const { brush, full } = useContext(DrawingToolsContext);
  const current = brush.value;
  const update = (patch: Partial<Brush>): void => {
    brush.value = { ...brush.value, ...patch };
  };
  return (
    <>
      <p class="panel-note">Draw on the preview. Two fingers zoom and pan; Move pans with one.</p>
      <Segmented
        legend="Brush"
        options={MODES}
        value={current.mode}
        onChange={(mode) => {
          update({ mode });
        }}
      />
      <Slider
        label="Brush size"
        min={0.005}
        max={0.5}
        step={0.005}
        value={current.size}
        format={(value) => `${(value * 100).toFixed(1)}%`}
        onInput={(size) => {
          update({ size });
        }}
        onCommit={() => {}}
      />
      <Slider
        label="Softness"
        min={0}
        max={1}
        step={0.01}
        value={current.softness}
        format={percent}
        onInput={(softness) => {
          update({ softness });
        }}
        onCommit={() => {}}
      />
      {current.mode === "smooth" ? null : (
        <Slider
          label={current.mode === "set" ? "Level" : "Amount"}
          min={0}
          max={1}
          step={0.01}
          value={current.value}
          format={percent}
          onInput={(value) => {
            update({ value });
          }}
          onCommit={() => {}}
        />
      )}
      {full.value ? (
        <p class="panel-note" role="status">
          The picture can't hold more strokes. Clear a drawing layer or undo some strokes to keep
          drawing.
        </p>
      ) : null}
      <div class="layer-actions">
        <button
          type="button"
          class="button"
          disabled={layer.strokes.length === 0}
          onClick={() => {
            change({ strokes: [] });
          }}
        >
          Clear layer
        </button>
      </div>
    </>
  );
}

export function DrawingIcon() {
  return (
    <svg class="layer-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M4 18c3-6 5 2 8-4s5-4 8-8"
        fill="none"
        stroke="currentColor"
        stroke-width="2.5"
        stroke-linecap="round"
      />
    </svg>
  );
}
