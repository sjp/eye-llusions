import { useSignal, type ReadonlySignal } from "@preact/signals";
import { useEffect, useRef, useState } from "preact/hooks";
import type { Recipe } from "../core/recipe.ts";
import type { RenderOutput } from "../render/protocol.ts";
import type { Editor } from "../state/editor.ts";
import { selectedLayer } from "../state/layers.ts";
import { DrawingSurface } from "./drawing/DrawingSurface.tsx";
import { cssTransform, IDENTITY } from "./drawing/navigation.ts";
import type { DrawingTool, DrawingTools } from "./drawing/tools.ts";
import { Preview, type Renderer } from "./Preview.tsx";
import { Segmented } from "./Segmented.tsx";

const OUTPUTS = [
  { value: "stereogram", label: "Stereogram" },
  { value: "depth", label: "Depth" },
] as const;

const TOOLS: readonly { value: DrawingTool; label: string }[] = [
  { value: "draw", label: "Draw" },
  { value: "move", label: "Move" },
];

type Props = {
  editor: Editor;
  renderer: Renderer;
  selection: ReadonlySignal<string | undefined>;
  tools: DrawingTools;
};

/**
 * The preview with its output toggle. While a drawing layer is selected, the preview
 * takes strokes, zooms and pans, and switches to the depth view until it is left.
 */
export function Stage({ editor, renderer, selection, tools }: Props) {
  const [output, setOutput] = useState<RenderOutput>("stereogram");
  const view = useSignal(IDENTITY);
  const shown = useSignal<Recipe | undefined>(undefined);
  const layer = selectedLayer(editor.recipe.value.layers, selection.value);
  const drawingLayer = layer?.kind === "drawing" ? layer : undefined;
  const drawingId = drawingLayer?.id;

  const shownOutput = useRef(output);
  shownOutput.current = output;
  /** The output from before a drawing layer was selected. */
  const outputBefore = useRef<RenderOutput | undefined>(undefined);

  useEffect(() => {
    if (drawingId === undefined) {
      view.value = IDENTITY;
      if (outputBefore.current !== undefined) {
        setOutput(outputBefore.current);
        outputBefore.current = undefined;
      }
    } else {
      outputBefore.current ??= shownOutput.current;
      setOutput("depth");
    }
  }, [drawingId, view]);

  const drawing = drawingId !== undefined;
  const zoomed = view.value !== IDENTITY;
  return (
    <main class="stage">
      <div class="stage-bar">
        <Segmented legend="Preview" options={OUTPUTS} value={output} onChange={setOutput} />
        {drawing ? (
          <Segmented
            legend="Tool"
            options={TOOLS}
            value={tools.tool.value}
            onChange={(tool) => {
              tools.tool.value = tool;
            }}
          />
        ) : null}
        {drawing && zoomed ? (
          <button
            type="button"
            class="button"
            onClick={() => {
              view.value = IDENTITY;
            }}
          >
            Reset zoom
          </button>
        ) : null}
      </div>
      <Preview
        editor={editor}
        renderer={renderer}
        output={output}
        transform={drawing ? cssTransform(view.value) : undefined}
        onShown={(recipe) => {
          shown.value = recipe;
        }}
      >
        {drawingLayer === undefined ? null : (
          <DrawingSurface
            key={drawingLayer.id}
            editor={editor}
            layerId={drawingLayer.id}
            strokes={drawingLayer.strokes.length}
            tools={tools}
            view={view}
            shown={shown}
          />
        )}
      </Preview>
    </main>
  );
}
