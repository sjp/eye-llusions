import { useSignal } from "@preact/signals";
import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { defaultRecipe } from "../core/recipe.ts";
import { Editor } from "../state/editor.ts";
import { linkPayload } from "../state/share.ts";
import { ControlSheet, type SheetSnap } from "./ControlSheet.tsx";
import { createDrawingTools, DrawingToolsContext } from "./drawing/tools.ts";
import { Gallery } from "./gallery/Gallery.tsx";
import type { GallerySample } from "./gallery/samples.ts";
import { LayersPanel } from "./layers/LayersPanel.tsx";
import { TexturePanel } from "./texture/TexturePanel.tsx";
import type { Renderer } from "./Preview.tsx";
import { renderPng, type ExportPng } from "./exportPng.ts";
import { LeaveDialog } from "./LeaveDialog.tsx";
import { NoticeBar, type Notice } from "./Notice.tsx";
import { SaveDialog } from "./SaveDialog.tsx";
import { ShareDialog } from "./ShareDialog.tsx";
import { Stage } from "./Stage.tsx";
import { useProjectFiles } from "./useProjectFiles.ts";
import { useRenderer } from "./useRenderer.ts";
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
  /** Renders the gallery's thumbnails; defaults to a worker of the gallery's own. */
  thumbnailRenderer?: Renderer;
  /** The first screen; by default the gallery, unless the address holds a shared scene. */
  start?: Screen;
};

type Dialog = "share" | "save" | "leave" | undefined;

type Screen = "gallery" | "create";

function hasFiles(event: DragEvent): boolean {
  return event.dataTransfer?.types.includes("Files") ?? false;
}

export function App({
  editor: givenEditor,
  renderer: givenRenderer,
  exportPng = renderPng,
  thumbnailRenderer,
  start: firstScreen,
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
  const [screen, setScreen] = useState<Screen>(
    () => firstScreen ?? (linkPayload(location.hash) === undefined ? "gallery" : "create"),
  );
  const showCreate = useCallback(() => {
    setScreen("create");
  }, []);
  const clearLink = useShareLink(editor, setNotice, showCreate);
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

  const start = (recipe = defaultRecipe()): void => {
    editor.open(recipe, { fresh: true });
    selection.value = undefined;
    setNotice(undefined);
  };

  if (screen === "gallery") {
    return (
      <Gallery
        renderer={thumbnailRenderer}
        onView={(sample: GallerySample) => {
          start(sample.recipe);
          enter();
        }}
        onRemix={(sample: GallerySample) => {
          start(sample.recipe);
          setScreen("create");
        }}
        onBlank={() => {
          start();
          setScreen("create");
        }}
      />
    );
  }

  const leave = (): void => {
    clearLink();
    setDialog(undefined);
    setNotice(undefined);
    setScreen("gallery");
  };

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
              aria-haspopup={editor.modified.value ? "dialog" : undefined}
              onClick={() => {
                if (editor.modified.value) {
                  setDialog("leave");
                } else {
                  leave();
                }
              }}
              aria-label="Gallery"
              title="Gallery"
            >
              <svg class="toolbar-icon" viewBox="0 0 24 24" aria-hidden="true">
                <rect x="4" y="4" width="7" height="7" rx="1" />
                <rect x="13" y="4" width="7" height="7" rx="1" />
                <rect x="4" y="13" width="7" height="7" rx="1" />
                <rect x="13" y="13" width="7" height="7" rx="1" />
              </svg>
            </button>
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
            onShared={() => {
              editor.markSaved();
            }}
          />
        )}
        {dialog === "save" && (
          <SaveDialog
            recipe={editor.recipe.value}
            exportPng={exportPng}
            onSaved={() => {
              editor.markSaved();
            }}
            onClose={() => {
              setDialog(undefined);
              saveButton.current?.focus();
            }}
          />
        )}
        {dialog === "leave" && (
          <LeaveDialog
            onLeave={leave}
            onStay={() => {
              setDialog(undefined);
            }}
          />
        )}
      </div>
    </DrawingToolsContext.Provider>
  );
}
