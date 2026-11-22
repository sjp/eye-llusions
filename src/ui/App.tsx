import { useSignal } from "@preact/signals";
import { useEffect, useRef, useState } from "preact/hooks";
import { RenderClient } from "../render/client.ts";
import { Editor } from "../state/editor.ts";
import { ControlSheet, type SheetSnap } from "./ControlSheet.tsx";
import { createDrawingTools, DrawingToolsContext } from "./drawing/tools.ts";
import { LayersPanel } from "./layers/LayersPanel.tsx";
import { TexturePanel } from "./texture/TexturePanel.tsx";
import type { Renderer } from "./Preview.tsx";
import { ShareDialog } from "./ShareDialog.tsx";
import { Stage } from "./Stage.tsx";
import { useShareLink } from "./useShareLink.ts";
import { useUndoShortcuts } from "./useUndoShortcuts.ts";
import { useViewMode } from "./useViewMode.ts";
import { Viewer } from "./Viewer.tsx";
import { ViewPanel } from "./ViewPanel.tsx";

type Props = {
  editor?: Editor;
  /** Defaults to a render worker owned by the app. */
  renderer?: Renderer;
};

function useRenderer(given: Renderer | undefined): Renderer {
  const [state] = useState(() => {
    if (given !== undefined) {
      return { renderer: given, owned: undefined };
    }
    const owned = new RenderClient();
    return { renderer: owned, owned };
  });
  useEffect(
    () => () => {
      state.owned?.dispose();
    },
    [state],
  );
  return state.renderer;
}

export function App({ editor: givenEditor, renderer: givenRenderer }: Props) {
  const [editor] = useState(() => givenEditor ?? new Editor());
  const renderer = useRenderer(givenRenderer);
  const selection = useSignal<string | undefined>(undefined);
  const [tools] = useState(createDrawingTools);
  const [snap, setSnap] = useState<SheetSnap>("peek");
  const [help, setHelp] = useState(true);
  const { viewing, enter, exit } = useViewMode();
  const viewButton = useRef<HTMLButtonElement>(null);
  const shareButton = useRef<HTMLButtonElement>(null);
  const [sharing, setSharing] = useState(false);
  const { notice, dismiss } = useShareLink(editor);
  const wasViewing = useRef(false);
  useUndoShortcuts(editor);

  useEffect(() => {
    if (wasViewing.current && !viewing) {
      viewButton.current?.focus();
    }
    wasViewing.current = viewing;
  }, [viewing]);

  if (viewing) {
    return (
      <Viewer editor={editor} renderer={renderer} onExit={exit} help={help} onHelp={setHelp} />
    );
  }

  return (
    <DrawingToolsContext.Provider value={tools}>
      <div class="shell" data-sheet={snap}>
        <header class="toolbar">
          <h1>Eye-llusion</h1>
          <div class="toolbar-actions">
            <button
              ref={shareButton}
              type="button"
              class="button"
              aria-haspopup="dialog"
              onClick={() => {
                setSharing(true);
              }}
            >
              Share
            </button>
            <button ref={viewButton} type="button" class="button" onClick={enter}>
              View
            </button>
            <button
              type="button"
              class="button"
              aria-keyshortcuts="Control+Z Meta+Z"
              disabled={!editor.canUndo.value}
              onClick={() => {
                editor.undo();
              }}
            >
              Undo
            </button>
            <button
              type="button"
              class="button"
              aria-keyshortcuts="Control+Shift+Z Meta+Shift+Z Control+Y"
              disabled={!editor.canRedo.value}
              onClick={() => {
                editor.redo();
              }}
            >
              Redo
            </button>
          </div>
          {notice !== undefined && (
            <div
              class={`notice ${notice.tone}`}
              role={notice.tone === "error" ? "alert" : "status"}
            >
              <p>{notice.text}</p>
              <button type="button" class="button" onClick={dismiss}>
                Dismiss
              </button>
            </div>
          )}
        </header>
        <Stage editor={editor} renderer={renderer} selection={selection} tools={tools} />
        <ControlSheet snap={snap} onSnap={setSnap}>
          <ViewPanel editor={editor} />
          <LayersPanel editor={editor} selection={selection} />
          <TexturePanel editor={editor} />
        </ControlSheet>
        {sharing && (
          <ShareDialog
            recipe={editor.recipe.value}
            onClose={() => {
              setSharing(false);
              shareButton.current?.focus();
            }}
          />
        )}
      </div>
    </DrawingToolsContext.Provider>
  );
}
