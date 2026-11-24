import { useSignal } from "@preact/signals";
import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { defaultRecipe, type Recipe } from "../core/recipe.ts";
import { Editor } from "../state/editor.ts";
import { linkPayload } from "../state/share.ts";
import { ControlSheet, type SheetSnap } from "./ControlSheet.tsx";
import { createDrawingTools, DrawingToolsContext } from "./drawing/tools.ts";
import { Gallery, type GalleryFocus } from "./gallery/Gallery.tsx";
import { GALLERY, type GallerySample } from "./gallery/samples.ts";
import { LayersPanel } from "./layers/LayersPanel.tsx";
import { TexturePanel } from "./texture/TexturePanel.tsx";
import type { Renderer } from "./Preview.tsx";
import { renderPng, type ExportPng } from "./exportPng.ts";
import { LeaveDialog } from "./LeaveDialog.tsx";
import { NoticeBar, type Notice } from "./Notice.tsx";
import { SaveDialog } from "./SaveDialog.tsx";
import { ShareDialog } from "./ShareDialog.tsx";
import { Stage } from "./Stage.tsx";
import { ToolbarMenu } from "./ToolbarMenu.tsx";
import { useProjectFiles } from "./useProjectFiles.ts";
import { useRenderer } from "./useRenderer.ts";
import { useCreateEntry } from "./useCreateEntry.ts";
import { useFileDrop } from "./useFileDrop.ts";
import { useMediaQuery } from "./useMediaQuery.ts";
import { useShareLink } from "./useShareLink.ts";
import { useUndoShortcuts } from "./useUndoShortcuts.ts";
import { useUnloadWarning } from "./useUnloadWarning.ts";
import { practiceRecipe } from "./practice.ts";
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

/** Below this width the file actions move into a menu, leaving room for wider fonts on large phones. */
const COMPACT_TOOLBAR = "(max-width: 449px)";

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
  const helpOpen = useRef(help);
  helpOpen.current = help;
  const { viewing, enter, exit, fullscreen, toggleFullscreen } = useViewMode(() => {
    // The instructions are the only thing that opens inside the viewer.
    if (!helpOpen.current) {
      return false;
    }
    helpOpen.current = false;
    setHelp(false);
    return true;
  });
  const viewButton = useRef<HTMLButtonElement>(null);
  const shareButton = useRef<HTMLButtonElement>(null);
  const saveButton = useRef<HTMLButtonElement>(null);
  const moreButton = useRef<HTMLButtonElement>(null);
  const galleryButton = useRef<HTMLButtonElement>(null);
  const createHeading = useRef<HTMLHeadingElement>(null);
  /** Where focus goes once the open dialog has gone. */
  const afterDialog = useRef<HTMLElement | null>(null);
  const [galleryFocus, setGalleryFocus] = useState<GalleryFocus | undefined>(undefined);
  /** The sample shown in a viewer opened from the gallery. */
  const [browsing, setBrowsing] = useState(0);
  /** Whether the gallery's viewer shows the practice image rather than a sample. */
  const [practising, setPractising] = useState(false);
  /** The gallery's how-to-view card shows until dismissed or something is viewed. */
  const [intro, setIntro] = useState(true);
  const compact = useMediaQuery(COMPACT_TOOLBAR);
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
  const toGallery = useCallback(() => {
    clearLink();
    setDialog(undefined);
    setNotice(undefined);
    setGalleryFocus("heading");
    setScreen("gallery");
  }, [clearLink]);
  const createEntry = useCreateEntry(
    useCallback(() => {
      if (editor.modified.peek()) {
        setDialog("leave");
        return true;
      }
      toGallery();
      return false;
    }, [editor, toGallery]),
  );
  const wasViewing = useRef(false);
  useUndoShortcuts(editor, screen === "create" && !viewing && dialog === undefined);
  useUnloadWarning(screen === "create" && editor.modified.value);

  const start = (recipe = defaultRecipe()): void => {
    editor.open(recipe, { fresh: true });
    selection.value = undefined;
    setNotice(undefined);
  };

  const enterCreate = (recipe?: Recipe): void => {
    start(recipe);
    createEntry.enter();
    setScreen("create");
  };

  const dropFile =
    screen === "gallery"
      ? (file: File): void => {
          enterCreate();
          void openFile(file, { fresh: true });
        }
      : (file: File): void => {
          void openFile(file);
        };
  // The viewer only shows the scene, so files dropped on it are ignored.
  useFileDrop(viewing ? undefined : dropFile);

  useEffect(() => {
    if (wasViewing.current && !viewing) {
      viewButton.current?.focus();
    }
    wasViewing.current = viewing;
  }, [viewing]);

  const shownScreen = useRef(screen);
  useEffect(() => {
    if (shownScreen.current !== screen && screen === "create") {
      createHeading.current?.focus();
    }
    shownScreen.current = screen;
  }, [screen]);

  useEffect(() => {
    if (dialog === undefined) {
      afterDialog.current?.focus();
      afterDialog.current = null;
    }
  }, [dialog]);

  const closeDialog = (focus: HTMLElement | null): void => {
    afterDialog.current = focus;
    setDialog(undefined);
  };

  const viewSample = (index: number): void => {
    const at = (index + GALLERY.length) % GALLERY.length;
    const sample = GALLERY[at];
    setBrowsing(at);
    setPractising(false);
    setIntro(false);
    // Leaving the viewer focuses the last sample seen.
    setGalleryFocus({ sample: sample.id });
    start(sample.recipe);
  };

  if (viewing) {
    return (
      <Viewer
        editor={editor}
        renderer={renderer}
        onExit={exit}
        help={help}
        onHelp={setHelp}
        fullscreen={fullscreen}
        onFullscreen={toggleFullscreen}
        practiceScene={screen === "gallery" && practising}
        browse={
          screen === "gallery" && !practising
            ? {
                title: GALLERY[browsing].title,
                onPrevious: () => {
                  viewSample(browsing - 1);
                },
                onNext: () => {
                  viewSample(browsing + 1);
                },
              }
            : undefined
        }
      />
    );
  }

  if (screen === "gallery") {
    return (
      <Gallery
        renderer={thumbnailRenderer}
        focus={galleryFocus}
        onView={(sample: GallerySample) => {
          viewSample(GALLERY.indexOf(sample));
          enter();
        }}
        onRemix={(sample: GallerySample) => {
          enterCreate(sample.recipe);
        }}
        onBlank={() => {
          enterCreate();
        }}
        intro={
          intro
            ? {
                onPractice: () => {
                  setIntro(false);
                  setPractising(true);
                  setGalleryFocus("heading");
                  start(practiceRecipe("wall", defaultRecipe().view.repeats));
                  enter();
                },
                onDismiss: () => {
                  setIntro(false);
                },
              }
            : undefined
        }
      />
    );
  }

  const leave = (): void => {
    createEntry.leave();
    toGallery();
  };

  const openPicker = (): void => {
    fileInput.current?.click();
  };
  const openSave = (): void => {
    setDialog("save");
  };
  const openShare = (): void => {
    setDialog("share");
  };
  const fileActions = [
    { label: "Open", onSelect: openPicker },
    { label: "Save", dialog: true, onSelect: openSave },
    { label: "Share", dialog: true, onSelect: openShare },
  ];

  return (
    <DrawingToolsContext.Provider value={tools}>
      <div class="shell" data-sheet={snap}>
        <header class="toolbar">
          <h1 ref={createHeading} tabIndex={-1}>
            Eye-llusion
          </h1>
          <div class="toolbar-actions">
            <button
              ref={galleryButton}
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
            {!compact && (
              <>
                <button type="button" class="button" onClick={openPicker}>
                  Open
                </button>
                <button
                  ref={saveButton}
                  type="button"
                  class="button"
                  aria-haspopup="dialog"
                  onClick={openSave}
                >
                  Save
                </button>
                <button
                  ref={shareButton}
                  type="button"
                  class="button"
                  aria-haspopup="dialog"
                  onClick={openShare}
                >
                  Share
                </button>
              </>
            )}
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
            {compact && <ToolbarMenu label="More" items={fileActions} buttonRef={moreButton} />}
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
              closeDialog(shareButton.current ?? moreButton.current);
            }}
            onDownloadPng={() => {
              setDialog("save");
            }}
            onShared={() => {
              editor.markSaved({ withAssets: false });
            }}
          />
        )}
        {dialog === "save" && (
          <SaveDialog
            recipe={editor.recipe.value}
            exportPng={exportPng}
            onSaved={() => {
              editor.markSaved({ withAssets: true });
            }}
            onClose={() => {
              closeDialog(saveButton.current ?? moreButton.current);
            }}
          />
        )}
        {dialog === "leave" && (
          <LeaveDialog
            imagesOnly={editor.imagesUnsaved.value}
            onLeave={leave}
            onStay={() => {
              closeDialog(galleryButton.current);
            }}
          />
        )}
      </div>
    </DrawingToolsContext.Provider>
  );
}
