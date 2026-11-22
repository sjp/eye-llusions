import type { Editor } from "../state/editor.ts";
import { Panel } from "./Panel.tsx";
import { Segmented } from "./Segmented.tsx";
import { Slider } from "./Slider.tsx";

const MODES = [
  { value: "wall", label: "Wall-eyed" },
  { value: "cross", label: "Cross-eyed" },
] as const;

export function ViewPanel({ editor }: { editor: Editor }) {
  const { view } = editor.recipe.value;
  const endEdit = (): void => {
    editor.endEdit();
  };
  return (
    <Panel title="View">
      <Slider
        label="Repeats"
        min={2}
        max={32}
        step={1}
        value={view.repeats}
        format={(value) => String(Math.round(value))}
        onInput={(repeats) => {
          editor.setView({ repeats }, { coalesce: "view.repeats" });
        }}
        onCommit={endEdit}
      />
      <Slider
        label="Depth of field"
        min={0.05}
        max={0.9}
        step={0.01}
        value={view.depthOfField}
        format={(value) => `${String(Math.round(value * 100))}%`}
        onInput={(depthOfField) => {
          editor.setView({ depthOfField }, { coalesce: "view.depthOfField" });
        }}
        onCommit={endEdit}
      />
      <Segmented
        legend="Viewing method"
        options={MODES}
        value={view.mode}
        onChange={(mode) => {
          editor.setView({ mode });
        }}
      />
      <button
        type="button"
        class="button"
        onClick={() => {
          editor.newSeed();
        }}
      >
        New seed
      </button>
    </Panel>
  );
}
