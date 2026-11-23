import { fireEvent, render, screen } from "@testing-library/preact";
import { useState } from "preact/hooks";
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

/** A viewer whose instructions open and close as the app's do. */
function setupWithHelp() {
  const editor = new Editor();
  const renderer: Renderer = {
    render: vi.fn<Renderer["render"]>(() => new Promise(() => {})),
  };
  const onExit = vi.fn<() => void>();
  function Harness() {
    const [help, setHelp] = useState(true);
    return (
      <Viewer editor={editor} renderer={renderer} onExit={onExit} help={help} onHelp={setHelp} />
    );
  }
  render(<Harness />);
  return { editor, onExit };
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

  test("the instructions cover only the image's viewing method", () => {
    setup("cross");
    const help = screen.getByRole("region", { name: "How to view" });
    expect(help.textContent).toContain("Hold a fingertip");
    expect(help.textContent).not.toContain("look through it");
  });

  test("the troubleshooting tips switch the viewing method as an undoable step", () => {
    const { editor } = setup("wall");
    expect(screen.getByText("Can't see it?")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Switch to cross-eyed" }));
    expect(editor.recipe.value.view.mode).toBe("cross");
    expect(screen.getByText("This image is made for cross-eyed viewing.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Switch to wall-eyed" })).toBeTruthy();
    editor.undo();
    expect(editor.recipe.value.view.mode).toBe("wall");
  });

  test("the practice image shows in place of the scene, which it leaves alone", () => {
    const { editor } = setupWithHelp();
    const before = editor.recipe.value;
    fireEvent.click(screen.getByRole("button", { name: "Try a practice image" }));
    expect(screen.queryByRole("region", { name: "How to view" })).toBeNull();
    const end = screen.getByRole("button", { name: "End practice" });
    expect(document.activeElement).toBe(end);
    expect(screen.getByText(/Practice image: look for/)).toBeTruthy();
    expect(editor.recipe.value).toBe(before);
    expect(editor.canUndo.value).toBe(false);

    // Practice in the help is offered only for the scene.
    fireEvent.click(screen.getByRole("button", { name: "How to view" }));
    expect(screen.queryByRole("button", { name: "Try a practice image" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Got it" }));

    fireEvent.click(end);
    expect(screen.queryByRole("button", { name: "End practice" })).toBeNull();
    expect(screen.queryByText(/Practice image/)).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "How to view" }));
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

  test("Got it returns focus to the button that opens the instructions", () => {
    const { onExit } = setupWithHelp();
    const gotIt = screen.getByRole("button", { name: "Got it" });
    gotIt.focus();
    fireEvent.click(gotIt);
    expect(screen.queryByRole("region", { name: "How to view" })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "How to view" }));
    expect(onExit).not.toHaveBeenCalled();
  });

  test("offers a full-screen toggle only where it can go full screen", () => {
    const onFullscreen = vi.fn<() => void>();
    const editor = new Editor();
    const renderer: Renderer = { render: vi.fn<Renderer["render"]>(() => new Promise(() => {})) };
    const { rerender } = render(
      <Viewer
        editor={editor}
        renderer={renderer}
        onExit={() => {}}
        help={false}
        onHelp={() => {}}
      />,
    );
    expect(screen.queryByRole("button", { name: "Full screen" })).toBeNull();
    rerender(
      <Viewer
        editor={editor}
        renderer={renderer}
        onExit={() => {}}
        help={false}
        onHelp={() => {}}
        fullscreen={true}
        onFullscreen={onFullscreen}
      />,
    );
    const toggle = screen.getByRole("button", { name: "Full screen" });
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(toggle);
    expect(onFullscreen).toHaveBeenCalledOnce();
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
