import { useEffect } from "preact/hooks";

/** While `active`, the browser asks before reloading, closing or navigating away. */
export function useUnloadWarning(active: boolean): void {
  useEffect(() => {
    if (!active) {
      return undefined;
    }
    const onBeforeUnload = (event: BeforeUnloadEvent): void => {
      event.preventDefault();
    };
    addEventListener("beforeunload", onBeforeUnload);
    return () => {
      removeEventListener("beforeunload", onBeforeUnload);
    };
  }, [active]);
}
