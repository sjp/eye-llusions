import { useEffect, useRef } from "preact/hooks";

function hasFiles(event: DragEvent): boolean {
  return event.dataTransfer?.types.includes("Files") ?? false;
}

/**
 * Keeps files dropped anywhere on the page from replacing the app, and passes the first
 * one to `onFile`, when given, unless something under the pointer took the drop first.
 */
export function useFileDrop(onFile: ((file: File) => void) | undefined): void {
  const handler = useRef(onFile);
  handler.current = onFile;

  useEffect(() => {
    const onDragOver = (event: DragEvent): void => {
      if (!event.defaultPrevented && hasFiles(event)) {
        event.preventDefault();
        if (event.dataTransfer !== null && handler.current === undefined) {
          event.dataTransfer.dropEffect = "none";
        }
      }
    };
    const onDrop = (event: DragEvent): void => {
      if (event.defaultPrevented || !hasFiles(event)) {
        return;
      }
      event.preventDefault();
      const file = event.dataTransfer?.files[0];
      if (file !== undefined) {
        handler.current?.(file);
      }
    };
    addEventListener("dragover", onDragOver);
    addEventListener("drop", onDrop);
    return () => {
      removeEventListener("dragover", onDragOver);
      removeEventListener("drop", onDrop);
    };
  }, []);
}
