import { fireEvent, render, screen } from "@testing-library/preact";
import { afterEach, describe, expect, test, vi } from "vitest";
import { ControlSheet, type SheetSnap } from "./ControlSheet.tsx";

const SCREEN = 800;

/** Lays out the sheet `height` tall on a screen 800 px tall, as a browser would. */
function layOut(sheet: HTMLElement, height: () => number): void {
  vi.spyOn(sheet, "getBoundingClientRect").mockImplementation(
    () => new DOMRect(0, 0, 400, height()),
  );
  const parent = sheet.parentElement;
  if (parent !== null) {
    vi.spyOn(parent, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 400, SCREEN));
  }
}

function setup(snap: SheetSnap = "peek") {
  const onSnap = vi.fn<(snap: SheetSnap) => void>();
  const { rerender } = render(
    <ControlSheet snap={snap} onSnap={onSnap}>
      <p>Body</p>
    </ControlSheet>,
  );
  const sheet = screen.getByRole("complementary", { name: "Controls" });
  const handle = screen.getByRole("button", { name: "Controls" });
  const heights = { peek: 128, half: SCREEN * 0.5, full: SCREEN * 0.88 };
  // Until dragged, the sheet rests at its snap's height; while dragged, it follows.
  layOut(sheet, () => {
    const dragged = sheet.style.getPropertyValue("--sheet-drag");
    return dragged === "" ? heights[snap] : Number.parseFloat(dragged);
  });
  const show = (next: SheetSnap) => {
    snap = next;
    rerender(
      <ControlSheet snap={next} onSnap={onSnap}>
        <p>Body</p>
      </ControlSheet>,
    );
  };
  return { sheet, handle, onSnap, show };
}

/** Drags the handle by `travel` pixels, upwards when positive, in `steps` moves. */
function drag(handle: HTMLElement, travel: number, { steps = 5, end = "up", pointerId = 1 } = {}) {
  const startY = 600;
  fireEvent.pointerDown(handle, { pointerId, button: 0, clientY: startY });
  for (let step = 1; step <= steps; step++) {
    fireEvent.pointerMove(handle, { pointerId, clientY: startY - (travel * step) / steps });
  }
  if (end === "up") {
    fireEvent.pointerUp(handle, { pointerId, clientY: startY - travel });
    fireEvent.click(handle);
  } else {
    fireEvent.pointerCancel(handle, { pointerId });
  }
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ControlSheet", () => {
  test("describes its state and what it controls", () => {
    const { handle, show } = setup();
    expect(handle.getAttribute("aria-expanded")).toBe("false");
    expect(handle.getAttribute("aria-controls")).toBe(screen.getByText("Body").parentElement?.id);
    expect(
      document.getElementById(handle.getAttribute("aria-describedby") ?? "")?.textContent,
    ).toBe("Collapsed");
    show("full");
    expect(handle.getAttribute("aria-expanded")).toBe("true");
    expect(
      document.getElementById(handle.getAttribute("aria-describedby") ?? "")?.textContent,
    ).toBe("Fully open");
  });

  test("a press toggles between collapsed and half open", () => {
    const { handle, onSnap, show } = setup();
    fireEvent.click(handle);
    expect(onSnap).toHaveBeenLastCalledWith("half");
    show("full");
    fireEvent.click(handle);
    expect(onSnap).toHaveBeenLastCalledWith("peek");
  });

  test("follows the pointer while dragged, within the screen", () => {
    const { sheet, handle } = setup();
    fireEvent.pointerDown(handle, { pointerId: 1, button: 0, clientY: 600 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientY: 500 });
    expect(sheet.style.getPropertyValue("--sheet-drag")).toBe("228px");
    expect(sheet.classList.contains("dragging")).toBe(true);
    fireEvent.pointerMove(handle, { pointerId: 1, clientY: -1000 });
    expect(sheet.style.getPropertyValue("--sheet-drag")).toBe(`${String(SCREEN)}px`);
    fireEvent.pointerMove(handle, { pointerId: 1, clientY: 2000 });
    expect(sheet.style.getPropertyValue("--sheet-drag")).toBe("0px");
    fireEvent.pointerUp(handle, { pointerId: 1 });
    expect(sheet.style.getPropertyValue("--sheet-drag")).toBe("");
    expect(sheet.classList.contains("dragging")).toBe(false);
  });

  test.each([
    { from: "peek", travel: 100, to: "peek" },
    { from: "peek", travel: 200, to: "half" },
    { from: "peek", travel: 500, to: "full" },
    { from: "full", travel: -150, to: "full" },
    { from: "full", travel: -200, to: "half" },
    { from: "half", travel: -250, to: "peek" },
  ] as const)("a drag from $from by $travel px snaps to $to", ({ from, travel, to }) => {
    const { handle, onSnap } = setup(from);
    drag(handle, travel);
    // The click that follows the release doesn't toggle the sheet as well.
    expect(onSnap.mock.calls).toEqual([[to]]);
  });

  test("a press that wobbles less than the drag threshold is still a press", () => {
    const { sheet, handle, onSnap } = setup();
    drag(handle, 5);
    expect(onSnap.mock.calls).toEqual([["half"]]);
    expect(sheet.style.getPropertyValue("--sheet-drag")).toBe("");
  });

  test("a cancelled drag snaps and leaves the next press working", () => {
    const { handle, onSnap } = setup();
    drag(handle, 300, { end: "cancel" });
    expect(onSnap.mock.calls).toEqual([["half"]]);
    fireEvent.click(handle);
    expect(onSnap).toHaveBeenLastCalledWith("half");
    expect(onSnap).toHaveBeenCalledTimes(2);
  });

  test("ignores other pointers and buttons than the one dragging", () => {
    const { sheet, handle, onSnap } = setup();
    fireEvent.pointerDown(handle, { pointerId: 1, button: 2, clientY: 600 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientY: 300 });
    expect(sheet.style.getPropertyValue("--sheet-drag")).toBe("");

    fireEvent.pointerDown(handle, { pointerId: 1, button: 0, clientY: 600 });
    fireEvent.pointerMove(handle, { pointerId: 2, clientY: 300 });
    fireEvent.pointerUp(handle, { pointerId: 2 });
    expect(sheet.style.getPropertyValue("--sheet-drag")).toBe("");
    expect(onSnap).not.toHaveBeenCalled();
  });

  test.each([
    { from: "peek", key: "Enter", to: "half" },
    { from: "full", key: " ", to: "peek" },
    { from: "half", key: "ArrowUp", to: "full" },
    { from: "full", key: "ArrowUp", to: "full" },
    { from: "half", key: "ArrowDown", to: "peek" },
    { from: "peek", key: "ArrowDown", to: "peek" },
  ] as const)("$key from $from goes to $to", ({ from, key, to }) => {
    const { handle, onSnap } = setup(from);
    const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
    fireEvent(handle, event);
    expect(event.defaultPrevented).toBe(true);
    expect(onSnap).toHaveBeenCalledWith(to);
  });

  test("leaves other keys alone", () => {
    const { handle, onSnap } = setup();
    const event = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
    fireEvent(handle, event);
    expect(event.defaultPrevented).toBe(false);
    expect(onSnap).not.toHaveBeenCalled();
  });
});
