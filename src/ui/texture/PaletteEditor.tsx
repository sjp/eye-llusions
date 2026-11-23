import { useEffect, useRef } from "preact/hooks";
import { RECIPE_LIMITS } from "../../core/parseRecipe.ts";
import type { Palette } from "../../core/recipe.ts";
import { luminanceSpread, MIN_LUMINANCE_SPREAD } from "../../core/texture/palette.ts";
import type { Editor } from "../../state/editor.ts";

const { min: MIN_STOPS, max: MAX_STOPS } = RECIPE_LIMITS.paletteStops;

function mix(from: string, to: string): string {
  const a = Number.parseInt(from.slice(1), 16);
  const b = Number.parseInt(to.slice(1), 16);
  const channel = (shift: number) =>
    Math.round((((a >>> shift) & 0xff) + ((b >>> shift) & 0xff)) / 2);
  const value = (channel(16) << 16) | (channel(8) << 8) | channel(0);
  return `#${value.toString(16).padStart(6, "0")}`;
}

type Action = "up" | "down" | "remove";

/** The custom palette's colours, darkest first, with controls to add, remove and reorder them. */
export function PaletteEditor({ stops, editor }: { stops: readonly string[]; editor: Editor }) {
  const list = useRef<HTMLOListElement>(null);
  /** The control to focus once the colours change: a row and the button pressed in it. */
  const refocus = useRef<{ row: number; action: Action } | undefined>(undefined);

  useEffect(() => {
    const target = refocus.current;
    refocus.current = undefined;
    const rows = list.current?.children;
    if (target === undefined || rows === undefined || rows.length === 0) {
      return;
    }
    const row = rows[Math.min(target.row, rows.length - 1)];
    const control = (action: Action) => {
      const button = row.querySelector<HTMLButtonElement>(`[data-action="${action}"]`);
      return button?.disabled === false ? button : null;
    };
    const other = target.action === "up" ? "down" : "up";
    const fallback = target.action === "remove" ? row.querySelector("input") : control(other);
    (control(target.action) ?? fallback)?.focus();
  }, [stops]);

  const set = (next: string[], options: { coalesce?: string } = {}) => {
    editor.setTexture({ palette: { type: "custom", stops: next } }, options);
  };
  const move = (from: number, to: number) => {
    const next = [...stops];
    [next[from], next[to]] = [next[to], next[from]];
    // Focus follows the colour as it moves.
    refocus.current = { row: to, action: to < from ? "up" : "down" };
    set(next);
  };
  const last = stops.length - 1;
  return (
    <fieldset class="palette-editor">
      <legend>Colours, dark end first</legend>
      <ol ref={list} class="palette-stops">
        {stops.map((stop, index) => {
          const name = `colour ${String(index + 1)}`;
          return (
            // Colours can repeat, so rows are keyed by position.
            // oxlint-disable-next-line react/no-array-index-key
            <li key={index}>
              <input
                type="color"
                class="palette-colour"
                aria-label={`Colour ${String(index + 1)}`}
                value={stop}
                onInput={(event) => {
                  const next = [...stops];
                  next[index] = event.currentTarget.value.toLowerCase();
                  set(next, { coalesce: "palette.colour" });
                }}
                onChange={() => {
                  editor.endEdit();
                }}
              />
              <button
                type="button"
                class="button layer-move"
                aria-label={`Move ${name} up`}
                data-action="up"
                disabled={index === 0}
                onClick={() => {
                  move(index, index - 1);
                }}
              >
                ↑
              </button>
              <button
                type="button"
                class="button layer-move"
                aria-label={`Move ${name} down`}
                data-action="down"
                disabled={index === last}
                onClick={() => {
                  move(index, index + 1);
                }}
              >
                ↓
              </button>
              <button
                type="button"
                class="button layer-move"
                aria-label={`Remove ${name}`}
                data-action="remove"
                disabled={stops.length <= MIN_STOPS}
                onClick={() => {
                  refocus.current = { row: index, action: "remove" };
                  set(stops.filter((_, i) => i !== index));
                }}
              >
                ×
              </button>
            </li>
          );
        })}
      </ol>
      <button
        type="button"
        class="button"
        disabled={stops.length >= MAX_STOPS}
        onClick={() => {
          // A new colour goes between the last two, so the light end stays put.
          set([...stops.slice(0, last), mix(stops[last - 1], stops[last]), stops[last]]);
        }}
      >
        Add colour
      </button>
    </fieldset>
  );
}

/** A gentle note when the palette's colours are too close in brightness to fuse. */
export function ContrastWarning({ palette }: { palette: Palette }) {
  return luminanceSpread(palette) < MIN_LUMINANCE_SPREAD ? (
    <p class="panel-note warning" role="status">
      These colours are too similar in brightness to fuse easily. Spread them from dark to light.
    </p>
  ) : null;
}
