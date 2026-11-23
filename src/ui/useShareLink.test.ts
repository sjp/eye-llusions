import { renderHook } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { defaultRecipe, type Recipe } from "../core/recipe.ts";
import { Editor } from "../state/editor.ts";
import { decodeRecipe, ShareLinkError } from "../state/share.ts";
import { act } from "../test/act.ts";
import type { Notice } from "./Notice.tsx";
import { useShareLink } from "./useShareLink.ts";

vi.mock(import("../state/share.ts"), async (original) => ({
  ...(await original()),
  decodeRecipe: vi.fn<typeof decodeRecipe>(),
}));

type Pending = { resolve: (recipe: Recipe) => void; reject: (error: unknown) => void };

/** Decodes still in flight, by payload. */
let pending: Map<string, Pending>;
const decode = vi.mocked(decodeRecipe);

function scene(seed: number): Recipe {
  return { ...defaultRecipe(), seed };
}

function setHash(payload: string | undefined, fire = true): void {
  history.replaceState(null, "", payload === undefined ? location.pathname : `#r=${payload}`);
  if (fire) {
    dispatchEvent(new HashChangeEvent("hashchange"));
  }
}

/** Lets settled decodes run their follow-ups. */
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await Promise.resolve();
  }
}

function setup() {
  const editor = new Editor(scene(1), () => 7);
  const open = vi.spyOn(editor, "open");
  const report = vi.fn<(notice: Notice | undefined) => void>();
  const onOpen = vi.fn<() => void>();
  const hook = renderHook(() => useShareLink(editor, report, onOpen));
  return { editor, open, report, onOpen, clear: hook.result.current, unmount: hook.unmount };
}

beforeEach(() => {
  pending = new Map();
  decode.mockReset();
  decode.mockImplementation(
    (payload) =>
      new Promise((resolve, reject) => {
        pending.set(payload, { resolve, reject });
      }),
  );
});

afterEach(() => {
  history.replaceState(null, "", location.pathname);
});

describe("useShareLink", () => {
  test("opens a link present on load with a fresh history", async () => {
    setHash("first", false);
    const { editor, open, onOpen, report } = setup();
    expect(decode).toHaveBeenCalledWith("first");
    pending.get("first")?.resolve(scene(2));
    await vi.waitFor(() => {
      expect(open).toHaveBeenCalledWith(scene(2), { fresh: true });
    });
    expect(editor.recipe.value.seed).toBe(2);
    expect(onOpen).toHaveBeenCalledOnce();
    expect(report).toHaveBeenLastCalledWith(undefined);
  });

  test("opens a link that arrives later as an undo step", async () => {
    const { open } = setup();
    expect(decode).not.toHaveBeenCalled();
    setHash("later");
    pending.get("later")?.resolve(scene(3));
    await vi.waitFor(() => {
      expect(open).toHaveBeenCalledWith(scene(3), { fresh: false });
    });
  });

  test("a newer link wins over an older one that decodes after it", async () => {
    const { editor, open, onOpen } = setup();
    setHash("slow");
    setHash("fast");
    pending.get("fast")?.resolve(scene(4));
    await vi.waitFor(() => {
      expect(editor.recipe.value.seed).toBe(4);
    });
    pending.get("slow")?.resolve(scene(5));
    await settle();
    expect(open).toHaveBeenCalledOnce();
    expect(onOpen).toHaveBeenCalledOnce();
    expect(editor.recipe.value.seed).toBe(4);
  });

  test("an older link failing after a newer one opened reports nothing", async () => {
    const { report, editor } = setup();
    setHash("slow");
    setHash("fast");
    pending.get("fast")?.resolve(scene(4));
    await vi.waitFor(() => {
      expect(editor.recipe.value.seed).toBe(4);
    });
    report.mockClear();
    pending.get("slow")?.reject(new ShareLinkError("damaged"));
    await settle();
    expect(report).not.toHaveBeenCalled();
  });

  test("reports a link that can't be opened and keeps the scene", async () => {
    const { editor, report, onOpen } = setup();
    setHash("broken");
    pending.get("broken")?.reject(new ShareLinkError("This link is damaged."));
    await vi.waitFor(() => {
      expect(report).toHaveBeenCalledWith({ tone: "error", text: "This link is damaged." });
    });
    setHash("odd");
    pending.get("odd")?.reject(new TypeError("unexpected"));
    await vi.waitFor(() => {
      expect(report).toHaveBeenLastCalledWith({
        tone: "error",
        text: "The shared scene couldn't be opened.",
      });
    });
    expect(editor.recipe.value.seed).toBe(1);
    expect(onOpen).not.toHaveBeenCalled();
  });

  test("ignores a hashchange to the link already open, or to no link", async () => {
    const { editor } = setup();
    setHash("same");
    pending.get("same")?.resolve(scene(6));
    await vi.waitFor(() => {
      expect(editor.recipe.value.seed).toBe(6);
    });
    setHash("same");
    setHash(undefined);
    expect(decode).toHaveBeenCalledOnce();
  });

  test("clearing takes the link out of the address, so it can be opened again", async () => {
    const { editor, clear } = setup();
    history.replaceState("state", "", `?q=1#r=again`);
    dispatchEvent(new HashChangeEvent("hashchange"));
    pending.get("again")?.resolve(scene(8));
    await vi.waitFor(() => {
      expect(editor.recipe.value.seed).toBe(8);
    });
    clear();
    expect(location.hash).toBe("");
    expect(location.search).toBe("?q=1");
    expect(history.state).toBe("state");

    setHash("again");
    expect(decode).toHaveBeenCalledTimes(2);
  });

  test("drops a link that decodes after unmounting, and stops listening", async () => {
    setHash("late", false);
    const { open, report, unmount } = setup();
    act(unmount);
    pending.get("late")?.resolve(scene(9));
    await settle();
    setHash("after");
    expect(decode).toHaveBeenCalledOnce();
    expect(open).not.toHaveBeenCalled();
    expect(report).not.toHaveBeenCalled();
  });
});
