import type { Signal } from "@preact/signals";
import { useCallback } from "preact/hooks";
import { RECIPE_LIMITS } from "../core/parseRecipe.ts";
import type { Editor } from "../state/editor.ts";
import { canAddLayer, insertLayer, selectedLayer, withFreeIdentity } from "../state/layers.ts";
import { ProjectFileError, readProject } from "../state/projectFile.ts";
import { ImageImportError, importImage } from "./layers/importImage.ts";
import { LAYER_KINDS } from "./layers/kinds.ts";
import type { Notice } from "./Notice.tsx";

/** Larger than any PNG the app saves: a 4096² picture plus the largest assets. */
const MAX_FILE_BYTES = 200 * 1024 * 1024;

/**
 * Opens PNG files saved by the app as an undoable change, or with a fresh history when
 * `fresh` is set. Other images can be added as an image layer instead. Problems and offers are reported as notices; `report` must
 * keep its identity across renders.
 */
export function useProjectFiles(
  editor: Editor,
  selection: Signal<string | undefined>,
  report: (notice: Notice | undefined) => void,
): (file: File, options?: { fresh?: boolean }) => Promise<void> {
  const addImageLayer = useCallback(
    async (file: File): Promise<void> => {
      report(undefined);
      const before = editor.recipe.value;
      if (!canAddLayer(before.layers)) {
        report({
          tone: "error",
          text: `A picture can have up to ${String(RECIPE_LIMITS.layers)} layers. Delete one to add the image.`,
        });
        return;
      }
      if (Object.keys(before.assets).length >= RECIPE_LIMITS.assets) {
        report({
          tone: "error",
          text: `A picture can hold up to ${String(RECIPE_LIMITS.assets)} images. Delete an image layer to add another.`,
        });
        return;
      }
      try {
        const asset = await importImage(file);
        const { recipe } = editor;
        const kind = LAYER_KINDS.image;
        if (kind === undefined) {
          return;
        }
        const layer = withFreeIdentity(recipe.value.layers, kind.create(recipe.value));
        const above = selectedLayer(recipe.value.layers, selection.value)?.id;
        editor.updateLayers((layers) => insertLayer(layers, layer, above), {
          assets: { [layer.asset]: asset },
        });
        selection.value = layer.id;
      } catch (problem) {
        report({
          tone: "error",
          text:
            problem instanceof ImageImportError
              ? problem.message
              : "That image couldn't be opened.",
        });
      }
    },
    [editor, selection, report],
  );

  return useCallback(
    async (file: File, { fresh = false }: { fresh?: boolean } = {}): Promise<void> => {
      if (file.size > MAX_FILE_BYTES) {
        report({ tone: "error", text: "That file is too large to be an Eye-llusion project." });
        return;
      }
      try {
        const recipe = await readProject(new Uint8Array(await file.arrayBuffer()));
        editor.open(recipe, { fresh });
        report(undefined);
      } catch (error) {
        if (error instanceof ProjectFileError && error.kind === "none") {
          report({
            tone: "error",
            text: `${error.message} Some apps remove it when they send or save images.`,
            action: {
              label: "Add as image layer",
              run: () => {
                void addImageLayer(file);
              },
            },
          });
        } else {
          report({
            tone: "error",
            text: error instanceof ProjectFileError ? error.message : "That file couldn't be read.",
          });
        }
      }
    },
    [editor, report, addImageLayer],
  );
}
