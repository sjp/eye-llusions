import { useEffect, useId, useRef, useState } from "preact/hooks";
import { referencedAssets } from "../core/assets.ts";
import type { Recipe } from "../core/recipe.ts";
import { encodeRecipe, LINK_LENGTH_WARNING, shareUrl } from "../state/share.ts";

type Props = {
  recipe: Recipe;
  onClose: () => void;
  /** Offered when the link can't carry the whole scene. */
  onDownloadPng?: () => void;
};

type Status = { tone: "info" | "error"; text: string };

const lengthFormat = new Intl.NumberFormat("en");

/**
 * Builds a link to the recipe and offers to copy or share it. The address bar only
 * changes to the link when the person copies or shares it.
 */
export function ShareDialog({ recipe, onClose, onDownloadPng }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const linkRef = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const [url, setUrl] = useState<string | undefined>(undefined);
  const [status, setStatus] = useState<Status | undefined>(undefined);
  const canShare = typeof navigator.share === "function";

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog !== null && !dialog.open) {
      dialog.showModal();
    }
  }, []);

  useEffect(() => {
    let current = true;
    const make = async (): Promise<void> => {
      try {
        const payload = await encodeRecipe(recipe);
        if (current) {
          setUrl(shareUrl(location.href, payload));
        }
      } catch {
        if (current) {
          setStatus({ tone: "error", text: "The link couldn't be made in this browser." });
        }
      }
    };
    void make();
    return () => {
      current = false;
    };
  }, [recipe]);

  const usesImages = referencedAssets(recipe).length > 0;
  const long = url !== undefined && url.length > LINK_LENGTH_WARNING;

  const publish = (link: string): void => {
    if (location.href !== link) {
      history.replaceState(history.state, "", link);
    }
  };

  const copy = async (link: string): Promise<void> => {
    publish(link);
    try {
      await navigator.clipboard.writeText(link);
      setStatus({ tone: "info", text: "Link copied." });
    } catch {
      linkRef.current?.select();
      setStatus({
        tone: "error",
        text: "The link couldn't be copied automatically. It's selected above for you to copy.",
      });
    }
  };

  const share = async (link: string): Promise<void> => {
    publish(link);
    try {
      await navigator.share({ title: "Eye-llusion", url: link });
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        setStatus({ tone: "error", text: "The link couldn't be shared. Copy it instead." });
      }
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
      <h2 id={titleId}>Share</h2>
      {usesImages && (
        <p class="panel-note warning" role="status">
          Images can't travel in a link: whoever opens it is asked to choose their own. A PNG
          download keeps the images.
        </p>
      )}
      {url === undefined ? (
        status === undefined && <p class="panel-note">Making the link…</p>
      ) : (
        <>
          <label class="share-link">
            <span>Link</span>
            <input
              ref={linkRef}
              type="text"
              readOnly
              value={url}
              onFocus={(event) => {
                event.currentTarget.select();
              }}
            />
          </label>
          <p class="panel-note" data-length={url.length}>
            {lengthFormat.format(url.length)} characters
          </p>
          {long && (
            <p class="panel-note warning" role="status">
              Some apps cut links this long short. A PNG download keeps the whole scene.
            </p>
          )}
        </>
      )}
      {status !== undefined && (
        <p class={status.tone === "error" ? "panel-note error" : "panel-note"} role="status">
          {status.text}
        </p>
      )}
      <div class="share-actions">
        <button
          type="button"
          class="button"
          disabled={url === undefined}
          onClick={() => {
            if (url !== undefined) {
              void copy(url);
            }
          }}
        >
          Copy link
        </button>
        {canShare && (
          <button
            type="button"
            class="button"
            disabled={url === undefined}
            onClick={() => {
              if (url !== undefined) {
                void share(url);
              }
            }}
          >
            Share…
          </button>
        )}
        {onDownloadPng !== undefined && (usesImages || long) && (
          <button type="button" class="button" onClick={onDownloadPng}>
            Download PNG
          </button>
        )}
        <button type="button" class="button" onClick={onClose}>
          Close
        </button>
      </div>
    </dialog>
  );
}
