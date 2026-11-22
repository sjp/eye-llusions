import { signal, type Signal } from "@preact/signals";
import { createContext } from "preact";
import type { Brush } from "../../core/recipe.ts";

export type DrawingTool = "draw" | "move";

/** Brush and tool choices while drawing. They belong to the session, not the recipe. */
export type DrawingTools = {
  brush: Signal<Brush>;
  tool: Signal<DrawingTool>;
  /** Set when a stroke was dropped because the recipe has no room for it. */
  full: Signal<boolean>;
};

export function createDrawingTools(): DrawingTools {
  return {
    brush: signal({ size: 0.06, softness: 0.3, mode: "set", value: 1 }),
    tool: signal("draw"),
    full: signal(false),
  };
}

export const DrawingToolsContext = createContext<DrawingTools>(createDrawingTools());
