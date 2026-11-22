import { useEffect } from "preact/hooks";
import { missingAssets } from "../core/assets.ts";
import type { Editor } from "../state/editor.ts";
import { decodeRecipe, linkPayload, ShareLinkError } from "../state/share.ts";
import type { Notice } from "./Notice.tsx";

function missingNotice(count: number): Notice | undefined {
  if (count === 0) {
    return undefined;
  }
  const images = count === 1 ? "an image" : `${String(count)} images`;
  return {
    tone: "info",
    text: `This scene uses ${images} that a link can't carry. Choose your own where the layers and texture say an image is missing.`,
  };
}

/**
 * Opens the shared scene in the address bar's `#r=` fragment, on load and whenever the
 * fragment changes. A link opened on load starts history over; a later one is an undo
 * step. A link that can't be opened leaves the current scene and reports an error notice.
 * `report` must keep its identity across renders.
 */
export function useShareLink(editor: Editor, report: (notice: Notice | undefined) => void): void {
  useEffect(() => {
    let latest = 0;
    let first = true;
    let opened: string | undefined;
    const open = async (): Promise<void> => {
      const payload = linkPayload(location.hash);
      const fresh = first;
      first = false;
      if (payload === undefined || payload === opened) {
        return;
      }
      opened = payload;
      const request = ++latest;
      try {
        const recipe = await decodeRecipe(payload);
        if (request === latest) {
          editor.open(recipe, { fresh });
          report(missingNotice(missingAssets(recipe).length));
        }
      } catch (error) {
        if (request === latest) {
          const text =
            error instanceof ShareLinkError
              ? error.message
              : "The shared scene couldn't be opened.";
          report({ tone: "error", text });
        }
      }
    };
    const onHashChange = (): void => {
      void open();
    };
    void open();
    addEventListener("hashchange", onHashChange);
    return () => {
      latest = -1;
      removeEventListener("hashchange", onHashChange);
    };
  }, [editor, report]);
}
