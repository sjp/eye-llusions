import { useCallback, useEffect, useRef, useState } from "preact/hooks";

/** The history state of the entry pushed on entering view mode. */
export const VIEW_ENTRY = "eye-llusion:view";

function ignore(): void {}

/**
 * Whether the full-screen viewer is open. Entering pushes a history entry, so the back
 * button or gesture leaves view mode instead of the app, and goes full screen where the
 * Fullscreen API allows; elsewhere, such as on iPhones, the viewer fills the viewport.
 * Exit by `exit`, Escape, going back or leaving full screen.
 */
export function useViewMode(): { viewing: boolean; enter: () => void; exit: () => void } {
  const [viewing, setViewing] = useState(false);
  const active = useRef(false);

  useEffect(() => {
    // A reload in view mode opens in Create, so the entry no longer means anything.
    if (history.state === VIEW_ENTRY) {
      history.replaceState(null, "");
    }
  }, []);

  const finish = useCallback(() => {
    active.current = false;
    setViewing(false);
    // Browsers without the Fullscreen API, such as on iPhones, leave it undefined.
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(ignore);
    }
  }, []);

  const exit = useCallback(() => {
    if (!active.current) {
      return;
    }
    if (history.state === VIEW_ENTRY) {
      // Going back fires popstate, which finishes.
      active.current = false;
      history.back();
    } else {
      finish();
    }
  }, [finish]);

  const enter = useCallback(() => {
    if (active.current) {
      return;
    }
    active.current = true;
    history.pushState(VIEW_ENTRY, "");
    setViewing(true);
    if (document.fullscreenEnabled) {
      document.documentElement.requestFullscreen({ navigationUI: "hide" }).catch(ignore);
    }
  }, []);

  useEffect(() => {
    const onPopState = (): void => {
      if (history.state !== VIEW_ENTRY) {
        finish();
      }
    };
    const onFullscreenChange = (): void => {
      if (!document.fullscreenElement) {
        exit();
      }
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape" && active.current) {
        event.preventDefault();
        exit();
      }
    };
    window.addEventListener("popstate", onPopState);
    document.addEventListener("fullscreenchange", onFullscreenChange);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("popstate", onPopState);
      document.removeEventListener("fullscreenchange", onFullscreenChange);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [exit, finish]);

  return { viewing, enter, exit };
}
