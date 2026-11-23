import { fireEvent, render, screen } from "@testing-library/preact";
import { afterEach, describe, expect, test, vi } from "vitest";
import { Editor } from "../state/editor.ts";
import type { Renderer } from "./Preview.tsx";
import { Viewer } from "./Viewer.tsx";

function setup(mode: "wall" | "cross" = "wall") {
  const editor = new Editor();
  editor.setView({ mode });
  const renderer: Renderer = {
    render: vi.fn<Renderer["render"]>(() => new Promise(() => {})),
  };
  const onExit = vi.fn<() => void>();
  const onHelp = vi.fn<(open: boolean) => void>();
  render(
    <Viewer editor={editor} renderer={renderer} onExit={onExit} help={true} onHelp={onHelp} />,
  );
  return { editor, onExit, onHelp };
}

describe("Viewer", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("focuses Exit and reports it", () => {
    const { onExit } = setup();
    const exit = screen.getByRole("button", { name: "Exit" });
    expect(document.activeElement).toBe(exit);
    fireEvent.click(exit);
    expect(onExit).toHaveBeenCalledOnce();
  });

  test("Peek toggles from the keyboard", () => {
    setup();
    const peek = screen.getByRole("button", { name: "Peek" });
    expect(peek.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(peek);
    expect(peek.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("img", { name: "Depth map preview" })).toBeTruthy();
    fireEvent.click(peek);
    expect(peek.getAttribute("aria-pressed")).toBe("false");
  });

  test("the hint follows the viewing method", () => {
    setup("cross");
    expect(screen.getByText(/Cross your eyes until you see three dots/)).toBeTruthy();
    expect(screen.getByText("This image is made for cross-eyed viewing.")).toBeTruthy();
  });

  test("both buttons close the open instructions", () => {
    const { onHelp } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Got it" }));
    expect(onHelp).toHaveBeenLastCalledWith(false);
    const toggle = screen.getByRole("button", { name: "How to view" });
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(toggle);
    expect(onHelp).toHaveBeenCalledTimes(2);
    expect(onHelp).toHaveBeenLastCalledWith(false);
  });

  test("only the advice is a live region", () => {
    setup();
    const live = document.querySelectorAll("[aria-live]");
    expect(live).toHaveLength(1);
    expect(live[0]?.classList.contains("viewer-advice")).toBe(true);
  });

  test("presets wait until the image has a size", () => {
    setup();
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Phone" }).disabled).toBe(true);
  });

  test("a preset sets the repeats for the shown size as one undo step", () => {
    // 1209.4 CSS pixels is 320 mm at 96 to the inch: ten 32 mm strips.
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
      DOMRect.fromRect({ width: (320 / 25.4) * 96, height: 1000 }),
    );
    const { editor } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Monitor" }));
    expect(editor.recipe.value.view.repeats).toBe(10);
    editor.undo();
    expect(editor.recipe.value.view.repeats).toBe(8);
  });
});
