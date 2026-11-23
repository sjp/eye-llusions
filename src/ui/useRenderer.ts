import { useEffect, useState } from "preact/hooks";
import { RenderClient } from "../render/client.ts";
import type { Renderer } from "./Preview.tsx";

/**
 * `given`, or else a render worker of the component's own that stops when the component
 * unmounts.
 */
export function useRenderer(given: Renderer | undefined): Renderer {
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
