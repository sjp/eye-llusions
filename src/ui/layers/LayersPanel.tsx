import { useSignal, type Signal } from "@preact/signals";
import { useId, useState } from "preact/hooks";
import { RECIPE_LIMITS } from "../../core/parseRecipe.ts";
import type { Asset, Layer } from "../../core/recipe.ts";
import type { Editor } from "../../state/editor.ts";
import {
  canAddLayer,
  changeLayer,
  duplicateLayer,
  duplicateProblem,
  insertLayer,
  moveLayer,
  removeLayer,
  selectedLayer,
  withFreeIdentity,
} from "../../state/layers.ts";
import { Panel } from "../Panel.tsx";
import { Slider } from "../Slider.tsx";
import { LAYER_KINDS, type LayerKind } from "./kinds.ts";

type BlendMode = Layer["blend"];

const POINTS_TOTAL = new Intl.NumberFormat("en").format(RECIPE_LIMITS.pointsTotal);

const BLEND_MODES: readonly { value: BlendMode; label: string }[] = [
  { value: "max", label: "Nearest wins" },
  { value: "add", label: "Add" },
  { value: "subtract", label: "Subtract" },
  { value: "replace", label: "Replace" },
];

type EditOptions = { coalesce?: string; assets?: Record<string, Asset> };
type CommonPatch = Partial<Pick<Layer, "name" | "visible" | "blend" | "depth">>;
type AddableKind = Pick<LayerKind<Layer>, "label" | "create">;

const ADDABLE: readonly AddableKind[] = Object.values(LAYER_KINDS);

function displayName(layer: Layer): string {
  return layer.name === "" ? "Untitled" : layer.name;
}

function sameKind<L extends Layer>(layer: Layer, like: L): layer is L {
  return layer.kind === like.kind;
}

function layerEditOptions(layer: Layer, { coalesce, assets }: EditOptions): EditOptions {
  return {
    ...(coalesce === undefined ? {} : { coalesce: `layer.${layer.id}.${coalesce}` }),
    ...(assets === undefined ? {} : { assets }),
  };
}

/** The kind's own settings, with edits applied to the layer by ID. */
function kindEditor<L extends Layer>(kind: LayerKind<L> | undefined, layer: L, editor: Editor) {
  if (kind === undefined) {
    return null;
  }
  const change = (patch: Partial<L>, options: EditOptions = {}): void => {
    editor.updateLayers(
      (layers) =>
        changeLayer(layers, layer.id, (each) =>
          sameKind(each, layer) ? { ...each, ...patch } : each,
        ),
      layerEditOptions(layer, options),
    );
  };
  const commit = (): void => {
    editor.endEdit();
  };
  return <kind.Editor layer={layer} recipe={editor.recipe.value} change={change} commit={commit} />;
}

function KindSettings({ editor, layer }: { editor: Editor; layer: Layer }) {
  switch (layer.kind) {
    case "sample":
      return kindEditor(LAYER_KINDS.sample, layer, editor);
    case "text":
      return kindEditor(LAYER_KINDS.text, layer, editor);
    case "drawing":
      return kindEditor(LAYER_KINDS.drawing, layer, editor);
    case "image":
      return kindEditor(LAYER_KINDS.image, layer, editor);
    default:
      return null;
  }
}

type RowProps = {
  layer: Layer;
  index: number;
  count: number;
  selected: boolean;
  dropTarget: boolean;
  /** Whether a layer row is being dragged, so drags of anything else pass through. */
  reordering: boolean;
  onSelect: () => void;
  onVisible: (visible: boolean) => void;
  onMove: (to: number) => void;
  onDragStart: () => void;
  onDragOver: () => void;
  onDrop: () => void;
  onDragEnd: () => void;
};

function LayerRow(props: RowProps) {
  const { layer, index, count, selected } = props;
  const Icon = LAYER_KINDS[layer.kind]?.Icon;
  const name = displayName(layer);
  let className = "layer-row";
  if (selected) {
    className += " selected";
  }
  if (props.dropTarget) {
    className += " drop-target";
  }
  return (
    <li
      class={className}
      draggable
      onDragStart={(event) => {
        event.dataTransfer?.setData("text/plain", layer.id);
        if (event.dataTransfer !== null) {
          event.dataTransfer.effectAllowed = "move";
        }
        props.onDragStart();
      }}
      onDragOver={(event) => {
        if (props.reordering) {
          event.preventDefault();
          props.onDragOver();
        }
      }}
      onDrop={(event) => {
        if (props.reordering) {
          event.preventDefault();
          props.onDrop();
        }
      }}
      onDragEnd={props.onDragEnd}
    >
      <label class="layer-visible">
        <input
          type="checkbox"
          checked={layer.visible}
          aria-label={`Show ${name}`}
          onChange={(event) => {
            props.onVisible(event.currentTarget.checked);
          }}
        />
      </label>
      <button type="button" class="layer-select" aria-pressed={selected} onClick={props.onSelect}>
        {Icon === undefined ? null : <Icon />}
        <span class={layer.visible ? "layer-name" : "layer-name hidden"}>{name}</span>
      </button>
      <button
        type="button"
        class="button layer-move"
        aria-label={`Move ${name} up`}
        disabled={index === count - 1}
        onClick={() => {
          props.onMove(index + 1);
        }}
      >
        ↑
      </button>
      <button
        type="button"
        class="button layer-move"
        aria-label={`Move ${name} down`}
        disabled={index === 0}
        onClick={() => {
          props.onMove(index - 1);
        }}
      >
        ↓
      </button>
    </li>
  );
}

function LayerSettings({ editor, layer }: { editor: Editor; layer: Layer }) {
  const nameId = useId();
  const blendId = useId();
  const change = (patch: CommonPatch, options: EditOptions = {}): void => {
    editor.updateLayers(
      (layers) => changeLayer(layers, layer.id, (each) => ({ ...each, ...patch })),
      layerEditOptions(layer, options),
    );
  };
  const commit = (): void => {
    editor.endEdit();
  };
  return (
    <div class="layer-settings" role="group" aria-label={`${displayName(layer)} settings`}>
      <div class="field">
        <label for={nameId}>Name</label>
        <input
          id={nameId}
          type="text"
          class="text-input"
          value={layer.name}
          maxLength={RECIPE_LIMITS.nameLength}
          onInput={(event) => {
            change({ name: event.currentTarget.value }, { coalesce: "name" });
          }}
          onChange={commit}
        />
      </div>
      <Slider
        label="Depth"
        min={0}
        max={1}
        step={0.01}
        value={layer.depth}
        format={(value) => `${String(Math.round(value * 100))}%`}
        onInput={(depth) => {
          change({ depth }, { coalesce: "depth" });
        }}
        onCommit={commit}
      />
      <div class="field">
        <label for={blendId}>Blend</label>
        <select
          id={blendId}
          class="select"
          value={layer.blend}
          onChange={(event) => {
            const { value } = event.currentTarget;
            const blend = BLEND_MODES.find((mode) => mode.value === value)?.value;
            if (blend !== undefined) {
              change({ blend });
            }
          }}
        >
          {BLEND_MODES.map((mode) => (
            <option key={mode.value} value={mode.value}>
              {mode.label}
            </option>
          ))}
        </select>
      </div>
      <KindSettings editor={editor} layer={layer} />
    </div>
  );
}

/**
 * The layer stack, top layer first, with the selected layer's settings below it.
 * Layers reorder by dragging on desktop, or with the up and down buttons anywhere.
 */
export function LayersPanel({
  editor,
  selection,
}: {
  editor: Editor;
  /** The selected layer's ID, shared with the preview; kept locally if not given. */
  selection?: Signal<string | undefined>;
}) {
  const { layers, aspect } = editor.recipe.value;
  const local = useSignal<string | undefined>(undefined);
  const selectedId = (selection ?? local).value;
  const setSelectedId = (id: string | undefined): void => {
    (selection ?? local).value = id;
  };
  const [dragging, setDragging] = useState<string | undefined>(undefined);
  const [over, setOver] = useState<string | undefined>(undefined);
  const selected = selectedLayer(layers, selectedId);
  const roomy = canAddLayer(layers);
  const problem = selected === undefined ? "layers" : duplicateProblem(layers, selected.id, aspect);
  const duplicable = problem === undefined;
  const duplicateNoteId = useId();
  // Without room for a layer, the note under the add buttons already explains why.
  const duplicateNote =
    problem === "points"
      ? `A copy would pass the limit of ${POINTS_TOTAL} drawn points in a picture.`
      : problem === "drawingArea"
        ? "A copy would pass the limit on how much drawing a picture can hold."
        : undefined;

  const add = (kind: AddableKind): void => {
    const layer = withFreeIdentity(layers, kind.create(editor.recipe.value));
    editor.updateLayers((current) => insertLayer(current, layer, selected?.id));
    setSelectedId(layer.id);
  };

  const endDrag = (): void => {
    setDragging(undefined);
    setOver(undefined);
  };

  return (
    <Panel title="Layers">
      <div class="layer-actions">
        {ADDABLE.map((kind) => (
          <button
            key={kind.label}
            type="button"
            class="button"
            disabled={!roomy}
            onClick={() => {
              add(kind);
            }}
          >
            Add {kind.label.toLowerCase()}
          </button>
        ))}
      </div>
      {roomy ? null : (
        <p class="panel-note">A picture can have up to {RECIPE_LIMITS.layers} layers.</p>
      )}
      {layers.length === 0 ? (
        <p class="panel-note">No layers yet. Add one to raise something out of the picture.</p>
      ) : (
        <ol class="layer-list" aria-label="Layer stack, top first">
          {layers
            .map((layer, index) => (
              <LayerRow
                key={layer.id}
                layer={layer}
                index={index}
                count={layers.length}
                selected={layer === selected}
                dropTarget={over === layer.id && dragging !== layer.id}
                reordering={dragging !== undefined}
                onSelect={() => {
                  setSelectedId(layer.id);
                }}
                onVisible={(visible) => {
                  editor.updateLayers((current) =>
                    changeLayer(current, layer.id, (each) => ({ ...each, visible })),
                  );
                }}
                onMove={(to) => {
                  editor.updateLayers((current) => moveLayer(current, layer.id, to));
                }}
                onDragStart={() => {
                  setDragging(layer.id);
                }}
                onDragOver={() => {
                  setOver(layer.id);
                }}
                onDrop={() => {
                  if (dragging !== undefined) {
                    const moving = dragging;
                    editor.updateLayers((current) =>
                      moveLayer(
                        current,
                        moving,
                        current.findIndex((each) => each.id === layer.id),
                      ),
                    );
                  }
                  endDrag();
                }}
                onDragEnd={endDrag}
              />
            ))
            .toReversed()}
        </ol>
      )}
      {selected === undefined ? null : (
        <>
          <div class="layer-actions">
            <button
              type="button"
              class="button"
              disabled={!duplicable}
              aria-describedby={duplicateNote === undefined ? undefined : duplicateNoteId}
              onClick={() => {
                const before = new Set(layers.map((layer) => layer.id));
                editor.updateLayers((current) => duplicateLayer(current, selected.id, aspect));
                const copy = editor.recipe.peek().layers.find((layer) => !before.has(layer.id));
                if (copy !== undefined) {
                  setSelectedId(copy.id);
                }
              }}
            >
              Duplicate
            </button>
            <button
              type="button"
              class="button"
              onClick={() => {
                const index = layers.indexOf(selected);
                editor.updateLayers((current) => removeLayer(current, selected.id));
                setSelectedId(layers[index === 0 ? 1 : index - 1]?.id);
              }}
            >
              Delete
            </button>
          </div>
          {duplicateNote === undefined ? null : (
            <p class="panel-note" id={duplicateNoteId}>
              {duplicateNote}
            </p>
          )}
          <LayerSettings key={selected.id} editor={editor} layer={selected} />
        </>
      )}
    </Panel>
  );
}
