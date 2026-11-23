import { useCallback, useEffect, useRef, useState } from "preact/hooks";

/** The history state of the entry pushed on entering view mode. */
export const VIEW_ENTRY = "eye-llusion:view";

function ignore(): void {}

/**
 * Whether the full-screen viewer is open. Entering pushes a history entry, so the back
 * button or gesture leaves view mode instead of the app, and goes full screen where the
 * Fullscreen API allows; elsewhere, such as on iPhones, the viewer fills the viewport.
 * Exit by `exit`, Escape, going back or leaving full screen. Escape, and leaving full
 * screen, which browsers also do on Escape, first call `closeInner` to close something
 * open inside the viewer; it returns true if it did, and the viewer stays.
 * `toggleFullscreen`, left out where the Fullscreen API isn't available, leaves or goes
 * back to full screen without leaving the viewer.
 */
export function useViewMode(closeInner?: () => boolean): {
  viewing: boolean;
  enter: () => void;
  exit: () => void;
  fullscreen: boolean;
  toggleFullscreen: (() => void) | undefined;
} {
  const [viewing, setViewing] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  // Browsers without the Fullscreen API, such as on iPhones, leave it undefined.
  const [canFullscreen] = useState(
    () => (document.fullscreenEnabled as boolean | undefined) ?? false,
  );
  /** Full screen was left by `toggleFullscreen`, so the viewer stays. */
  const leaving = useRef(false);
  const active = useRef(false);
  const inner = useRef(closeInner);
  inner.current = closeInner;
  /** An Escape that closed something inside the viewer, before leaving full screen. */
  const escaped = useRef(false);

  useEffect(() => {
    // A reload in view mode opens in Create, so the entry no longer means anything.
    if (history.state === VIEW_ENTRY) {
      history.replaceState(null, "");
    }
  }, []);

  const finish = useCallback(() => {
    active.current = false;
    setViewing(false);
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
    escaped.current = false;
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
      setFullscreen(Boolean(document.fullscreenElement));
      if (document.fullscreenElement) {
        return;
      }
      if (leaving.current) {
        leaving.current = false;
        return;
      }
      const stay = escaped.current || (active.current && inner.current?.() === true);
      escaped.current = false;
      if (!stay) {
        exit();
      }
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Escape" || !active.current || event.defaultPrevented) {
        return;
      }
      event.preventDefault();
      if (inner.current?.() === true) {
        escaped.current = Boolean(document.fullscreenElement);
      } else {
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

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) {
      leaving.current = true;
      document.exitFullscreen().catch(() => {
        leaving.current = false;
      });
    } else {
      document.documentElement.requestFullscreen({ navigationUI: "hide" }).catch(ignore);
    }
  }, []);

  return {
    viewing,
    enter,
    exit,
    fullscreen,
    toggleFullscreen: canFullscreen ? toggleFullscreen : undefined,
  };
}
