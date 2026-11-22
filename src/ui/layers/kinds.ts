import type { FunctionComponent } from "preact";
import type { Layer } from "../../core/recipe.ts";
import { SampleEditor, SampleIcon } from "./SampleEditor.tsx";
import { TextEditor, TextIcon } from "./TextEditor.tsx";

type EditOptions = { coalesce?: string };

export type LayerEditorProps<L extends Layer> = {
  layer: L;
  /**
   * Applies `patch` to the layer as one undoable edit. Edits that pass the same
   * `coalesce` key merge into one undo step until `commit` is called.
   */
  change: (patch: Partial<L>, options?: EditOptions) => void;
  /** Ends a coalesced edit. */
  commit: () => void;
};

/** What the layer panel needs to know about one kind of layer. */
export type LayerKind<L extends Layer> = {
  /** Short display name, such as "Shape". */
  label: string;
  Icon: FunctionComponent;
  /** A new layer with default settings; the panel makes `id` and `name` unique. */
  create: () => L;
  /** The settings specific to this kind. */
  Editor: FunctionComponent<LayerEditorProps<L>>;
};

type Registry = { [K in Layer["kind"]]?: LayerKind<Extract<Layer, { kind: K }>> };

/** Kinds without an entry can't be added and have no kind-specific editor. */
export const LAYER_KINDS: Registry = {
  sample: {
    label: "Shape",
    Icon: SampleIcon,
    create: () => ({
      kind: "sample",
      id: "sample",
      name: "Sphere",
      visible: true,
      blend: "max",
      depth: 1,
      shape: { type: "sphere" },
      center: { x: 0.5, y: 0.5 },
      size: 0.5,
    }),
    Editor: SampleEditor,
  },
  text: {
    label: "Text",
    Icon: TextIcon,
    create: () => ({
      kind: "text",
      id: "text",
      name: "Text",
      visible: true,
      blend: "max",
      depth: 1,
      text: "HELLO",
      font: "anton",
      size: 0.3,
      center: { x: 0.5, y: 0.5 },
      edge: "round",
      edgeWidth: 0.03,
    }),
    Editor: TextEditor,
  },
};
