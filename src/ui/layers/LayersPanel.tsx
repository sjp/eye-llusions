import { useId, useState } from "preact/hooks";
import { RECIPE_LIMITS } from "../../core/parseRecipe.ts";
import type { Layer } from "../../core/recipe.ts";
import type { Editor } from "../../state/editor.ts";
import {
  canAddLayer,
  changeLayer,
  duplicateLayer,
  freeLayerId,
  freeLayerName,
  insertLayer,
  moveLayer,
  removeLayer,
} from "../../state/layers.ts";
import { Panel } from "../Panel.tsx";
import { Slider } from "../Slider.tsx";
import { LAYER_KINDS, type LayerKind } from "./kinds.ts";

type BlendMode = Layer["blend"];

const BLEND_MODES: readonly { value: BlendMode; label: string }[] = [
  { value: "max", label: "Nearest wins" },
  { value: "add", label: "Add" },
  { value: "subtract", label: "Subtract" },
  { value: "replace", label: "Replace" },
];

type EditOptions = { coalesce?: string };
type CommonPatch = Partial<Pick<Layer, "name" | "visible" | "blend" | "depth">>;
type AddableKind = Pick<LayerKind<Layer>, "label" | "create">;

const ADDABLE: readonly AddableKind[] = Object.values(LAYER_KINDS);

function displayName(layer: Layer): string {
  return layer.name === "" ? "Untitled" : layer.name;
}

function sameKind<L extends Layer>(layer: Layer, like: L): layer is L {
  return layer.kind === like.kind;
}

function coalesceKey(layer: Layer, options: EditOptions): EditOptions {
  return options.coalesce === undefined
    ? {}
    : { coalesce: `layer.${layer.id}.${options.coalesce}` };
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
      coalesceKey(layer, options),
    );
  };
  const commit = (): void => {
    editor.endEdit();
  };
  return <kind.Editor layer={layer} change={change} commit={commit} />;
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
        event.preventDefault();
        props.onDragOver();
      }}
      onDrop={(event) => {
        event.preventDefault();
        props.onDrop();
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
      coalesceKey(layer, options),
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
export function LayersPanel({ editor }: { editor: Editor }) {
  const { layers } = editor.recipe.value;
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);
  const [dragging, setDragging] = useState<string | undefined>(undefined);
  const [over, setOver] = useState<string | undefined>(undefined);
  const selected = layers.find((layer) => layer.id === selectedId) ?? layers.at(-1);
  const roomy = canAddLayer(layers);

  const add = (kind: AddableKind): void => {
    const fresh = kind.create();
    const layer = {
      ...fresh,
      id: freeLayerId(layers, fresh.kind),
      name: freeLayerName(layers, fresh.name),
    };
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
              disabled={!roomy}
              onClick={() => {
                const before = new Set(layers.map((layer) => layer.id));
                editor.updateLayers((current) => duplicateLayer(current, selected.id));
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
          <LayerSettings key={selected.id} editor={editor} layer={selected} />
        </>
      )}
    </Panel>
  );
}
