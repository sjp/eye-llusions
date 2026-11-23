import { useCallback, useEffect, useRef } from "preact/hooks";
import { linkPayload } from "../state/share.ts";
import { VIEW_ENTRY } from "./useViewMode.ts";

/** The history state of the entry pushed on entering Create from the gallery. */
const CREATE_ENTRY = "eye-llusion:create";

/**
 * A history entry for Create, so the back button or gesture returns to the gallery
 * instead of leaving the app. `enter` pushes it and `leave` takes it off again. Going
 * back past it calls `onBack`, which returns true to stay in Create, pushing the entry
 * again. Moves between Create's own entries, such as the viewer's or an opened share
 * link's, don't count as leaving. `onBack` must keep its identity across renders.
 */
export function useCreateEntry(onBack: () => boolean): { enter: () => void; leave: () => void } {
  const entered = useRef(false);

  useEffect(() => {
    // A reload opens on the gallery or a shared link, so the entry no longer means anything.
    if (history.state === CREATE_ENTRY) {
      history.replaceState(null, "");
    }
  }, []);

  const enter = useCallback(() => {
    entered.current = true;
    history.pushState(CREATE_ENTRY, "");
  }, []);

  const leave = useCallback(() => {
    if (!entered.current) {
      return;
    }
    entered.current = false;
    if (history.state === CREATE_ENTRY) {
      history.back();
    }
  }, []);

  useEffect(() => {
    const onPopState = (): void => {
      const state: unknown = history.state;
      if (
        entered.current &&
        state !== CREATE_ENTRY &&
        state !== VIEW_ENTRY &&
        linkPayload(location.hash) === undefined
      ) {
        if (onBack()) {
          history.pushState(CREATE_ENTRY, "");
        } else {
          entered.current = false;
        }
      }
    };
    addEventListener("popstate", onPopState);
    return () => {
      removeEventListener("popstate", onPopState);
    };
  }, [onBack]);

  return { enter, leave };
}
