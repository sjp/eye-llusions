import { renderHook } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act } from "../test/act.ts";
import { useViewMode, VIEW_ENTRY } from "./useViewMode.ts";

/** Stands in for the Fullscreen API, which happy-dom lacks. */
let fullscreen: Element | null = null;
const requestFullscreen = vi.fn<() => Promise<void>>();
const exitFullscreen = vi.fn<() => Promise<void>>();
const back = vi.fn<() => void>();

function setFullscreen(element: Element | null): void {
  fullscreen = element;
  document.dispatchEvent(new Event("fullscreenchange"));
}

/** Goes back, as the back button or gesture does. */
function goBack(): void {
  history.back();
}

beforeEach(() => {
  history.replaceState(null, "");
  fullscreen = null;
  requestFullscreen.mockReset();
  requestFullscreen.mockImplementation(() => {
    fullscreen = document.documentElement;
    return Promise.resolve();
  });
  exitFullscreen.mockReset();
  exitFullscreen.mockImplementation(() => {
    fullscreen = null;
    return Promise.resolve();
  });
  Object.defineProperty(document, "fullscreenElement", {
    configurable: true,
    get: () => fullscreen,
  });
  Object.defineProperty(document, "fullscreenEnabled", { configurable: true, value: true });
  Object.defineProperty(document, "exitFullscreen", { configurable: true, value: exitFullscreen });
  Object.defineProperty(document.documentElement, "requestFullscreen", {
    configurable: true,
    value: requestFullscreen,
  });
  // happy-dom's history doesn't go back; this pops one entry and fires popstate.
  back.mockReset();
  back.mockImplementation(() => {
    history.replaceState(null, "");
    window.dispatchEvent(new PopStateEvent("popstate", { state: null }));
  });
  vi.spyOn(history, "back").mockImplementation(back);
});

afterEach(() => {
  for (const name of ["fullscreenElement", "fullscreenEnabled", "exitFullscreen"]) {
    Reflect.deleteProperty(document, name);
  }
  Reflect.deleteProperty(document.documentElement, "requestFullscreen");
  vi.restoreAllMocks();
});

function setup(closeInner?: () => boolean) {
  return renderHook(() => useViewMode(closeInner));
}

describe("useViewMode", () => {
  test("entering pushes a history entry and goes full screen", () => {
    const { result } = setup();
    expect(result.current.viewing).toBe(false);
    act(() => {
      result.current.enter();
    });
    expect(result.current.viewing).toBe(true);
    expect(history.state).toBe(VIEW_ENTRY);
    expect(requestFullscreen).toHaveBeenCalledWith({ navigationUI: "hide" });
  });

  test("doesn't ask for full screen where it isn't available, and still enters", () => {
    Object.defineProperty(document, "fullscreenEnabled", { configurable: true, value: false });
    const { result } = setup();
    act(() => {
      result.current.enter();
    });
    expect(result.current.viewing).toBe(true);
    expect(requestFullscreen).not.toHaveBeenCalled();
  });

  test("entering twice pushes one entry", () => {
    const push = vi.spyOn(history, "pushState");
    const { result } = setup();
    act(() => {
      result.current.enter();
      result.current.enter();
    });
    expect(push).toHaveBeenCalledOnce();
  });

  test("exit goes back through history, leaving full screen", () => {
    const { result } = setup();
    act(() => {
      result.current.enter();
    });
    act(() => {
      result.current.exit();
    });
    expect(back).toHaveBeenCalledOnce();
    expect(result.current.viewing).toBe(false);
    expect(exitFullscreen).toHaveBeenCalledOnce();
  });

  test("exit finishes directly once the history entry is gone", () => {
    const { result } = setup();
    act(() => {
      result.current.enter();
    });
    history.replaceState(null, "");
    act(() => {
      result.current.exit();
    });
    expect(back).not.toHaveBeenCalled();
    expect(result.current.viewing).toBe(false);
  });

  test("exit does nothing when not viewing", () => {
    const { result } = setup();
    act(() => {
      result.current.exit();
    });
    expect(back).not.toHaveBeenCalled();
  });

  test("going back leaves view mode", () => {
    const { result } = setup();
    act(() => {
      result.current.enter();
    });
    act(goBack);
    expect(result.current.viewing).toBe(false);
    expect(fullscreen).toBeNull();
  });

  test("a popstate that lands on the viewer's entry keeps viewing", () => {
    const { result } = setup();
    act(() => {
      result.current.enter();
    });
    act(() => {
      window.dispatchEvent(new PopStateEvent("popstate", { state: VIEW_ENTRY }));
    });
    expect(result.current.viewing).toBe(true);
  });

  test("leaving full screen leaves view mode", () => {
    const { result } = setup();
    act(() => {
      result.current.enter();
    });
    act(() => {
      setFullscreen(null);
    });
    expect(result.current.viewing).toBe(false);
    expect(back).toHaveBeenCalledOnce();
  });

  test("going full screen, or a change while not viewing, leaves things be", () => {
    const { result } = setup();
    act(() => {
      result.current.enter();
      setFullscreen(document.documentElement);
    });
    expect(result.current.viewing).toBe(true);
    act(() => {
      result.current.exit();
    });
    act(() => {
      setFullscreen(null);
    });
    expect(back).toHaveBeenCalledOnce();
  });

  test("leaving full screen closes something inside the viewer first", () => {
    const closeInner = vi.fn<() => boolean>(() => true);
    const { result } = setup(closeInner);
    act(() => {
      result.current.enter();
    });
    act(() => {
      setFullscreen(null);
    });
    expect(closeInner).toHaveBeenCalledOnce();
    expect(result.current.viewing).toBe(true);
  });

  test("Escape closes something inside the viewer first, then leaves", () => {
    let open = true;
    const closeInner = vi.fn<() => boolean>(() => {
      const was = open;
      open = false;
      return was;
    });
    const { result } = setup(closeInner);
    act(() => {
      result.current.enter();
    });
    const escape = () => new KeyboardEvent("keydown", { key: "Escape", cancelable: true });
    let event = escape();
    act(() => {
      window.dispatchEvent(event);
    });
    expect(event.defaultPrevented).toBe(true);
    expect(result.current.viewing).toBe(true);
    // The browser leaves full screen on the same Escape; that doesn't leave the viewer.
    act(() => {
      setFullscreen(null);
    });
    expect(result.current.viewing).toBe(true);

    event = escape();
    act(() => {
      window.dispatchEvent(event);
    });
    expect(result.current.viewing).toBe(false);
  });

  test("ignores other keys, Escape when not viewing and Escape already handled", () => {
    const { result } = setup();
    const keydown = (init: KeyboardEventInit) => {
      const event = new KeyboardEvent("keydown", { ...init, cancelable: true });
      act(() => {
        window.dispatchEvent(event);
      });
      return event;
    };
    expect(keydown({ key: "Escape" }).defaultPrevented).toBe(false);
    act(() => {
      result.current.enter();
    });
    expect(keydown({ key: "Enter" }).defaultPrevented).toBe(false);
    const handled = new KeyboardEvent("keydown", { key: "Escape", cancelable: true });
    handled.preventDefault();
    act(() => {
      window.dispatchEvent(handled);
    });
    expect(result.current.viewing).toBe(true);
  });

  test("a reload on the viewer's entry clears it, opening outside view mode", () => {
    history.replaceState(VIEW_ENTRY, "");
    const { result } = setup();
    expect(history.state).toBeNull();
    expect(result.current.viewing).toBe(false);
  });

  test("stops listening once unmounted", () => {
    const { result, unmount } = setup();
    act(() => {
      result.current.enter();
    });
    unmount();
    window.dispatchEvent(new PopStateEvent("popstate", { state: null }));
    expect(exitFullscreen).not.toHaveBeenCalled();
  });
});
