import { signal } from "@preact/signals";
import { renderHook } from "@testing-library/preact";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { defaultRecipe, type Recipe } from "../core/recipe.ts";
import { Editor } from "../state/editor.ts";
import { readProjectOffThread } from "../state/projectFileWorker.ts";
import type { Notice } from "./Notice.tsx";
import { useProjectFiles } from "./useProjectFiles.ts";

vi.mock(import("../state/projectFileWorker.ts"), async (original) => ({
  ...(await original()),
  readProjectOffThread: vi.fn<typeof readProjectOffThread>(),
}));

type Pending = { resolve: (recipe: Recipe) => void; reject: (error: unknown) => void };

/** Reads still in flight, by the file's first byte. */
let pending: Map<number, Pending>;
const read = vi.mocked(readProjectOffThread);

function file(id: number): File {
  return new File([Uint8Array.of(id)], `${String(id)}.png`, { type: "image/png" });
}

function scene(seed: number): Recipe {
  return { ...defaultRecipe(), seed };
}

function setup() {
  const editor = new Editor(scene(1), () => 7);
  const report = vi.fn<(notice: Notice | undefined) => void>();
  const { result } = renderHook(() => useProjectFiles(editor, signal(undefined), report));
  return { editor, report, open: result.current };
}

/** Waits until a read of the file has started. */
async function reading(id: number): Promise<Pending> {
  await vi.waitFor(() => {
    expect(pending.has(id)).toBe(true);
  });
  return pending.get(id) ?? { resolve: () => {}, reject: () => {} };
}

beforeEach(() => {
  pending = new Map();
  read.mockReset();
  read.mockImplementation(
    (bytes) =>
      new Promise((resolve, reject) => {
        pending.set(bytes[0], { resolve, reject });
      }),
  );
});

describe("useProjectFiles", () => {
  test("the file opened last wins when an earlier one finishes reading after it", async () => {
    const { editor, open } = setup();
    const slow = open(file(1));
    const fast = open(file(2));
    (await reading(2)).resolve(scene(20));
    await fast;
    expect(editor.recipe.value.seed).toBe(20);
    (await reading(1)).resolve(scene(10));
    await slow;
    expect(editor.recipe.value.seed).toBe(20);
  });

  test("an earlier file failing after a later one opened reports nothing", async () => {
    const { editor, report, open } = setup();
    const slow = open(file(1));
    const fast = open(file(2));
    (await reading(2)).resolve(scene(20));
    await fast;
    report.mockClear();
    (await reading(1)).reject(new Error("unreadable"));
    await slow;
    expect(report).not.toHaveBeenCalled();
    expect(editor.recipe.value.seed).toBe(20);
  });
});
