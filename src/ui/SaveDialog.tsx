import { useEffect, useId, useRef, useState } from "preact/hooks";
import type { Recipe } from "../core/recipe.ts";
import {
  EXPORT_LARGE_PIXELS,
  EXPORT_MIN_WIDTH,
  EXPORT_PRESETS,
  exportSizeForWidth,
  maxExportWidth,
  presetExportSize,
} from "../render/resolution.ts";
import { downloadBlob, type ExportPng } from "./exportPng.ts";

type Props = {
  recipe: Recipe;
  onClose: () => void;
  exportPng: ExportPng;
  /** Called once the PNG has been downloaded or shared. */
  onSaved?: () => void;
};

type Choice = (typeof EXPORT_PRESETS)[number]["id"] | "custom";

type Made = { recipe: Recipe; width: number; height: number; file: File };

type Status = { tone: "info" | "error"; text: string };

const sizeFormat = new Intl.NumberFormat("en");

function canShareFiles(): boolean {
  if (typeof navigator.canShare !== "function" || typeof navigator.share !== "function") {
    return false;
  }
  try {
    return navigator.canShare({ files: [new File([], "test.png", { type: "image/png" })] });
  } catch {
    return false;
  }
}

/**
 * Renders the picture at a chosen size into a PNG that also keeps the project, then
 * downloads or shares it. The last file made is reused while nothing changes.
 */
export function SaveDialog({ recipe, onClose, exportPng, onSaved }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const widthId = useId();
  const [choice, setChoice] = useState<Choice>("hd");
  const [customWidth, setCustomWidth] = useState(1920);
  const [made, setMade] = useState<Made | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status | undefined>(undefined);
  const [canShare] = useState(canShareFiles);
  const mounted = useRef(true);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog !== null && !dialog.open) {
      dialog.showModal();
    }
    return () => {
      mounted.current = false;
    };
  }, []);

  const preset = EXPORT_PRESETS.find((each) => each.id === choice);
  const size =
    preset === undefined
      ? exportSizeForWidth(recipe.aspect, customWidth)
      : presetExportSize(recipe.aspect, preset);
  const large = size.width * size.height > EXPORT_LARGE_PIXELS;
  const ready =
    made?.recipe === recipe && made.width === size.width && made.height === size.height
      ? made.file
      : undefined;

  const make = async (): Promise<File | undefined> => {
    if (ready !== undefined) {
      return ready;
    }
    setBusy(true);
    setStatus({ tone: "info", text: "Making the PNG…" });
    try {
      const blob = await exportPng(recipe, size);
      const name = `eye-llusion-${String(size.width)}x${String(size.height)}.png`;
      const file = new File([blob], name, { type: "image/png" });
      if (mounted.current) {
        setMade({ recipe, ...size, file });
        setStatus(undefined);
      }
      return file;
    } catch {
      if (mounted.current) {
        setStatus({
          tone: "error",
          text: "The PNG couldn't be made. Try a smaller size.",
        });
      }
      return undefined;
    } finally {
      if (mounted.current) {
        setBusy(false);
      }
    }
  };

  const download = async (): Promise<void> => {
    const file = await make();
    if (file !== undefined) {
      downloadBlob(file, file.name);
      onSaved?.();
    }
  };

  const share = async (): Promise<void> => {
    const fresh = ready === undefined;
    const file = await make();
    if (file === undefined) {
      return;
    }
    try {
      await navigator.share({ files: [file], title: "Eye-llusion" });
      onSaved?.();
    } catch (error) {
      if (!(error instanceof DOMException) || error.name === "AbortError") {
        return;
      }
      setStatus(
        fresh && error.name === "NotAllowedError"
          ? { tone: "info", text: "The PNG is ready. Choose Share again to send it." }
          : { tone: "error", text: "The PNG couldn't be shared. Download it instead." },
      );
    }
  };

  return (
    <dialog
      ref={dialogRef}
      class="share-dialog"
      aria-labelledby={titleId}
      onClose={onClose}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <h2 id={titleId}>Save PNG</h2>
      <fieldset class="export-sizes">
        <legend>Size</legend>
        {[...EXPORT_PRESETS, { id: "custom" as const, label: "Custom" }].map((option) => {
          const optionSize =
            option.id === "custom" ? undefined : presetExportSize(recipe.aspect, option);
          return (
            <label key={option.id}>
              <input
                type="radio"
                name={titleId}
                value={option.id}
                checked={choice === option.id}
                onChange={() => {
                  setChoice(option.id);
                }}
              />
              <span>{option.label}</span>
              {optionSize !== undefined && (
                <span class="export-size">
                  {optionSize.width} × {optionSize.height}
                </span>
              )}
            </label>
          );
        })}
      </fieldset>
      {choice === "custom" && (
        <div class="export-custom">
          <label for={widthId}>Width</label>
          <input
            id={widthId}
            type="number"
            inputMode="numeric"
            min={EXPORT_MIN_WIDTH}
            max={maxExportWidth(recipe.aspect)}
            step={1}
            value={customWidth}
            onChange={(event) => {
              const value = Number(event.currentTarget.value);
              if (Number.isFinite(value) && value > 0) {
                setCustomWidth(exportSizeForWidth(recipe.aspect, value).width);
              } else {
                event.currentTarget.value = String(customWidth);
              }
            }}
          />
          <span>× {size.height} pixels</span>
        </div>
      )}
      <p class="panel-note" data-width={size.width} data-height={size.height}>
        {sizeFormat.format(size.width)} × {sizeFormat.format(size.height)} pixels. The PNG also
        keeps the project, images included: open it here to edit it again.
      </p>
      {large && (
        <p class="panel-note warning" role="status">
          Sizes this large take a while and can run out of memory on phones.
        </p>
      )}
      <p class="panel-note">
        Some apps remove the project from images they send. Send the file as a document to keep it.
      </p>
      {status !== undefined && (
        <p class={status.tone === "error" ? "panel-note error" : "panel-note"} role="status">
          {status.text}
        </p>
      )}
      <div class="share-actions">
        <button
          type="button"
          class="button"
          disabled={busy}
          onClick={() => {
            void download();
          }}
        >
          Download
        </button>
        {canShare && (
          <button
            type="button"
            class="button"
            disabled={busy}
            onClick={() => {
              void share();
            }}
          >
            Share…
          </button>
        )}
        <button type="button" class="button" onClick={onClose}>
          Close
        </button>
      </div>
    </dialog>
  );
}
