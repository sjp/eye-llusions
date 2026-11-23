import { useEffect } from "preact/hooks";
import type { Editor } from "../state/editor.ts";

const NON_TEXT_INPUTS = new Set(["range", "radio", "checkbox", "button", "submit", "color"]);

/** Whether the element has its own text undo, which the shortcuts should leave alone. */
function editsText(target: EventTarget | null): boolean {
  if (target instanceof HTMLTextAreaElement) {
    return true;
  }
  if (target instanceof HTMLInputElement) {
    return !NON_TEXT_INPUTS.has(target.type);
  }
  return target instanceof HTMLElement && target.isContentEditable;
}

/** Ctrl/Cmd+Z undoes; Ctrl/Cmd+Shift+Z and Ctrl+Y redo, while `enabled`. */
export function useUndoShortcuts(editor: Editor, enabled: boolean): void {
  useEffect(() => {
    if (!enabled) {
      return undefined;
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (
        event.defaultPrevented ||
        event.altKey ||
        !(event.ctrlKey || event.metaKey) ||
        editsText(event.target)
      ) {
        return;
      }
      const key = event.key.toLowerCase();
      if (key === "z" && !event.shiftKey) {
        editor.undo();
      } else if ((key === "z" && event.shiftKey) || (key === "y" && event.ctrlKey)) {
        editor.redo();
      } else {
        return;
      }
      event.preventDefault();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [editor, enabled]);
}
