import { useEffect, useId, useRef } from "preact/hooks";
import { FONTS, uncoveredCharacters } from "../../core/fonts.ts";
import { RECIPE_LIMITS } from "../../core/parseRecipe.ts";
import type { TextLayer } from "../../core/recipe.ts";
import { Segmented } from "../Segmented.tsx";
import { Slider } from "../Slider.tsx";
import type { LayerEditorProps } from "./kinds.ts";

type EdgeProfile = TextLayer["edge"];

const EDGES: readonly { value: EdgeProfile; label: string }[] = [
  { value: "flat", label: "Flat" },
  { value: "bevel", label: "Bevel" },
  { value: "round", label: "Round" },
];

const LICENCES: Partial<Record<string, string>> = {
  anton: new URL("../../assets/fonts/anton/OFL.txt", import.meta.url).href,
  "archivo-black": new URL("../../assets/fonts/archivo-black/OFL.txt", import.meta.url).href,
  "alfa-slab-one": new URL("../../assets/fonts/alfa-slab-one/OFL.txt", import.meta.url).href,
};

/** A pause in typing this long ends the undo step. */
const TYPING_BURST_MS = 1000;

const percent = (value: number): string => `${String(Math.round(value * 100))}%`;

function TextField({ layer, change, commit }: LayerEditorProps<TextLayer>) {
  const id = useId();
  const noteId = useId();
  const idle = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(
    () => () => {
      clearTimeout(idle.current);
    },
    [],
  );
  const uncovered = uncoveredCharacters(layer.text);
  return (
    <div class="field">
      <label for={id}>Text</label>
      <textarea
        id={id}
        class="text-input text-area"
        rows={3}
        value={layer.text}
        maxLength={RECIPE_LIMITS.textLength}
        aria-describedby={uncovered.length > 0 ? noteId : undefined}
        onInput={(event) => {
          change({ text: event.currentTarget.value }, { coalesce: "text" });
          clearTimeout(idle.current);
          idle.current = setTimeout(commit, TYPING_BURST_MS);
        }}
        onChange={() => {
          clearTimeout(idle.current);
          commit();
        }}
      />
      {uncovered.length === 0 ? null : (
        <p id={noteId} class="panel-note">
          The fonts don't include {uncovered.slice(0, 8).join(" ")}
          {uncovered.length > 8 ? " …" : ""}, so those characters may look different on other
          devices.
        </p>
      )}
    </div>
  );
}

function FontField({ layer, change }: LayerEditorProps<TextLayer>) {
  const id = useId();
  const licence = LICENCES[layer.font];
  return (
    <div class="field">
      <label for={id}>Font</label>
      <select
        id={id}
        class="select"
        value={layer.font}
        onChange={(event) => {
          change({ font: event.currentTarget.value });
        }}
      >
        {FONTS.map((font) => (
          <option key={font.id} value={font.id}>
            {font.label}
          </option>
        ))}
      </select>
      {licence === undefined ? null : (
        <a class="panel-note" href={licence} target="_blank" rel="noreferrer">
          Font licence (SIL Open Font License)
        </a>
      )}
    </div>
  );
}

export function TextEditor(props: LayerEditorProps<TextLayer>) {
  const { layer, change, commit } = props;
  return (
    <>
      <TextField {...props} />
      <FontField {...props} />
      <Slider
        label="Size"
        min={0.02}
        max={1}
        step={0.01}
        value={layer.size}
        format={percent}
        onInput={(size) => {
          change({ size }, { coalesce: "size" });
        }}
        onCommit={commit}
      />
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
      <Segmented
        legend="Edge"
        options={EDGES}
        value={layer.edge}
        onChange={(edge) => {
          change({ edge });
        }}
      />
      {layer.edge === "flat" ? null : (
        <Slider
          label="Edge width"
          min={0.005}
          max={0.25}
          step={0.005}
          value={layer.edgeWidth}
          format={(value) => `${(value * 100).toFixed(1)}%`}
          onInput={(edgeWidth) => {
            change({ edgeWidth }, { coalesce: "edgeWidth" });
          }}
          onCommit={commit}
        />
      )}
    </>
  );
}

export function TextIcon() {
  return (
    <svg class="layer-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 6h14M12 6v13" fill="none" stroke="currentColor" stroke-width="2.5" />
    </svg>
  );
}
