import { useSignal } from "@preact/signals";
import { useEffect, useRef, useState } from "preact/hooks";
import { RenderClient } from "../render/client.ts";
import { Editor } from "../state/editor.ts";
import { ControlSheet, type SheetSnap } from "./ControlSheet.tsx";
import { createDrawingTools, DrawingToolsContext } from "./drawing/tools.ts";
import { LayersPanel } from "./layers/LayersPanel.tsx";
import { TexturePanel } from "./texture/TexturePanel.tsx";
import type { Renderer } from "./Preview.tsx";
import { renderPng, type ExportPng } from "./exportPng.ts";
import { NoticeBar, type Notice } from "./Notice.tsx";
import { SaveDialog } from "./SaveDialog.tsx";
import { ShareDialog } from "./ShareDialog.tsx";
import { Stage } from "./Stage.tsx";
import { useProjectFiles } from "./useProjectFiles.ts";
import { useShareLink } from "./useShareLink.ts";
import { useUndoShortcuts } from "./useUndoShortcuts.ts";
import { useViewMode } from "./useViewMode.ts";
import { Viewer } from "./Viewer.tsx";
import { ViewPanel } from "./ViewPanel.tsx";

type Props = {
  editor?: Editor;
  /** Defaults to a render worker owned by the app. */
  renderer?: Renderer;
  /** Defaults to rendering PNG files in a worker of their own. */
  exportPng?: ExportPng;
};

type Dialog = "share" | "save" | undefined;

function hasFiles(event: DragEvent): boolean {
  return event.dataTransfer?.types.includes("Files") ?? false;
}

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

export function App({
  editor: givenEditor,
  renderer: givenRenderer,
  exportPng = renderPng,
}: Props) {
  const [editor] = useState(() => givenEditor ?? new Editor());
  const renderer = useRenderer(givenRenderer);
  const selection = useSignal<string | undefined>(undefined);
  const [tools] = useState(createDrawingTools);
  const [snap, setSnap] = useState<SheetSnap>("peek");
  const [help, setHelp] = useState(true);
  const { viewing, enter, exit } = useViewMode();
  const viewButton = useRef<HTMLButtonElement>(null);
  const shareButton = useRef<HTMLButtonElement>(null);
  const saveButton = useRef<HTMLButtonElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [dialog, setDialog] = useState<Dialog>(undefined);
  const [notice, setNotice] = useState<Notice | undefined>(undefined);
  useShareLink(editor, setNotice);
  const openFile = useProjectFiles(editor, selection, setNotice);
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
      <div
        class="shell"
        data-sheet={snap}
        onDragOver={(event) => {
          if (!event.defaultPrevented && hasFiles(event)) {
            event.preventDefault();
          }
        }}
        onDrop={(event) => {
          const file = event.dataTransfer?.files[0];
          if (!event.defaultPrevented && file !== undefined) {
            event.preventDefault();
            void openFile(file);
          }
        }}
      >
        <header class="toolbar">
          <h1>Eye-llusion</h1>
          <div class="toolbar-actions">
            <button
              type="button"
              class="button"
              onClick={() => {
                fileInput.current?.click();
              }}
            >
              Open
            </button>
            <input
              ref={fileInput}
              type="file"
              accept="image/png,.png"
              class="visually-hidden"
              aria-label="PNG file"
              tabIndex={-1}
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                event.currentTarget.value = "";
                if (file !== undefined) {
                  void openFile(file);
                }
              }}
            />
            <button
              ref={saveButton}
              type="button"
              class="button"
              aria-haspopup="dialog"
              onClick={() => {
                setDialog("save");
              }}
            >
              Save
            </button>
            <button
              ref={shareButton}
              type="button"
              class="button"
              aria-haspopup="dialog"
              onClick={() => {
                setDialog("share");
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
            <NoticeBar
              notice={notice}
              onDismiss={() => {
                setNotice(undefined);
              }}
            />
          )}
        </header>
        <Stage editor={editor} renderer={renderer} selection={selection} tools={tools} />
        <ControlSheet snap={snap} onSnap={setSnap}>
          <ViewPanel editor={editor} />
          <LayersPanel editor={editor} selection={selection} />
          <TexturePanel editor={editor} />
        </ControlSheet>
        {dialog === "share" && (
          <ShareDialog
            recipe={editor.recipe.value}
            onClose={() => {
              setDialog(undefined);
              shareButton.current?.focus();
            }}
            onDownloadPng={() => {
              setDialog("save");
            }}
          />
        )}
        {dialog === "save" && (
          <SaveDialog
            recipe={editor.recipe.value}
            exportPng={exportPng}
            onClose={() => {
              setDialog(undefined);
              saveButton.current?.focus();
            }}
          />
        )}
      </div>
    </DrawingToolsContext.Provider>
  );
}
