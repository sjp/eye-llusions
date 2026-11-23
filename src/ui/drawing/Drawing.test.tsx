import { fireEvent, render, screen } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { DrawingLayer } from "../../core/recipe.ts";
import { Editor } from "../../state/editor.ts";
import { App } from "../App.tsx";
import type { Renderer } from "../Preview.tsx";

function setup() {
  const editor = new Editor(undefined, () => 7);
  const renderer: Renderer = {
    render: vi.fn<Renderer["render"]>(() => new Promise(() => {})),
  };
  render(<App start="create" editor={editor} renderer={renderer} />);
  fireEvent.click(screen.getByRole("button", { name: "Add drawing" }));
  return editor;
}

function drawing(editor: Editor): DrawingLayer {
  const layer = editor.recipe.value.layers.find((each) => each.kind === "drawing");
  if (layer?.kind !== "drawing") {
    throw new Error("No drawing layer");
  }
  return layer;
}

function surface(): HTMLElement {
  return screen.getByRole("img", { name: "Drawing surface" });
}

type Pointer = { pointerId: number; pointerType: string; x: number; y: number };

function down({ pointerId, pointerType, x, y }: Pointer): void {
  fireEvent.pointerDown(surface(), { pointerId, pointerType, button: 0, clientX: x, clientY: y });
}

function move({ pointerId, pointerType, x, y }: Pointer): void {
  fireEvent.pointerMove(surface(), { pointerId, pointerType, clientX: x, clientY: y });
}

function up({ pointerId, pointerType, x, y }: Pointer): void {
  fireEvent.pointerUp(surface(), { pointerId, pointerType, clientX: x, clientY: y });
}

function stroke(pointerType: string, points: [number, number][]): void {
  const pointer = (x: number, y: number) => ({ pointerId: 1, pointerType, x, y });
  const [first, ...rest] = points;
  down(pointer(...first));
  for (const point of rest) {
    move(pointer(...point));
  }
  up(pointer(...(points.at(-1) ?? first)));
}

describe("drawing on the preview", () => {
  beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
      DOMRect.fromRect({ x: 0, y: 0, width: 400, height: 200 }),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("selecting a drawing layer switches the preview to depth", () => {
    setup();
    expect(screen.getByRole<HTMLInputElement>("radio", { name: "Depth" }).checked).toBe(true);
    expect(screen.getByRole<HTMLInputElement>("radio", { name: "Draw" }).checked).toBe(true);
  });

  test("a mouse stroke adds one simplified stroke with the brush, undone in one step", () => {
    const editor = setup();
    fireEvent.click(screen.getByRole("radio", { name: "Raise" }));
    stroke("mouse", [
      [100, 100],
      [150, 100],
      [200, 100],
      [300, 150],
    ]);
    const [added] = drawing(editor).strokes;
    expect(added.brush).toMatchObject({ mode: "raise", size: 0.06 });
    // The middle of three collinear points is dropped.
    expect(added.points).toEqual([0.25, 0.5, 0.5, 0.5, 0.75, 0.75]);
    editor.undo();
    expect(drawing(editor).strokes).toEqual([]);
  });

  test("a pen's pressure scales the brush", () => {
    const editor = setup();
    fireEvent.pointerDown(surface(), {
      pointerId: 3,
      pointerType: "pen",
      pressure: 1,
      clientX: 10,
      clientY: 10,
    });
    fireEvent.pointerUp(surface(), { pointerId: 3, pointerType: "pen", clientX: 10, clientY: 10 });
    expect(drawing(editor).strokes[0].brush.size).toBeCloseTo(0.09);
  });

  test("a second finger cancels the stroke and pinches instead", () => {
    const editor = setup();
    const a = { pointerId: 1, pointerType: "touch" };
    const b = { pointerId: 2, pointerType: "touch" };
    down({ ...a, x: 150, y: 100 });
    move({ ...a, x: 160, y: 100 });
    down({ ...b, x: 250, y: 100 });
    move({ ...a, x: 100, y: 100 });
    move({ ...b, x: 300, y: 100 });
    up({ ...a, x: 100, y: 100 });
    move({ ...b, x: 320, y: 100 });
    up({ ...b, x: 320, y: 100 });
    expect(drawing(editor).strokes).toEqual([]);
    expect(editor.canUndo.value).toBe(true);
    const preview = document.querySelector<HTMLElement>(".preview-surface");
    // The fingers spread from 90 to 200 pixels apart.
    const scale = Number(/scale\(([\d.]+)\)/.exec(preview?.style.transform ?? "")?.[1]);
    expect(scale).toBeCloseTo(200 / 90);
    fireEvent.click(screen.getByRole("button", { name: "Reset zoom" }));
    expect(preview?.style.transform).toBe("translate(0px, 0px) scale(1)");
  });

  test("the zoom buttons zoom in and back out", () => {
    setup();
    const preview = document.querySelector<HTMLElement>(".preview-surface");
    const zoomOut = screen.getByRole<HTMLButtonElement>("button", { name: "Zoom out" });
    expect(zoomOut.disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(preview?.style.transform).toBe("translate(0px, 0px) scale(1.5)");
    expect(screen.getByRole("button", { name: "Reset zoom" })).toBeTruthy();
    fireEvent.click(zoomOut);
    expect(preview?.style.transform).toBe("translate(0px, 0px) scale(1)");
    expect(zoomOut.disabled).toBe(true);
    expect(screen.queryByRole("button", { name: "Reset zoom" })).toBeNull();
  });

  test("a palm resting while the pen draws is ignored", () => {
    const editor = setup();
    const pen = { pointerId: 1, pointerType: "pen" };
    const palm = { pointerId: 2, pointerType: "touch" };
    down({ ...pen, x: 100, y: 100 });
    down({ ...palm, x: 300, y: 150 });
    move({ ...pen, x: 150, y: 100 });
    move({ ...palm, x: 320, y: 170 });
    up({ ...pen, x: 150, y: 100 });
    move({ ...palm, x: 340, y: 190 });
    up({ ...palm, x: 340, y: 190 });
    expect(drawing(editor).strokes).toHaveLength(1);
    expect(document.querySelector<HTMLElement>(".preview-surface")?.style.transform).toBe(
      "translate(0px, 0px) scale(1)",
    );
  });

  test("a palm that lands before the pen gives way to it", () => {
    const editor = setup();
    const palm = { pointerId: 2, pointerType: "touch" };
    const pen = { pointerId: 1, pointerType: "pen" };
    down({ ...palm, x: 300, y: 150 });
    down({ ...pen, x: 100, y: 100 });
    move({ ...palm, x: 320, y: 170 });
    move({ ...pen, x: 150, y: 100 });
    up({ ...pen, x: 150, y: 100 });
    up({ ...palm, x: 320, y: 170 });
    expect(drawing(editor).strokes).toHaveLength(1);
    expect(drawing(editor).strokes[0].points[0]).toBeCloseTo(0.25);
    expect(document.querySelector<HTMLElement>(".preview-surface")?.style.transform).toBe(
      "translate(0px, 0px) scale(1)",
    );
  });

  test("a pointer whose capture is lost no longer counts as down", () => {
    const editor = setup();
    down({ pointerId: 1, pointerType: "touch", x: 100, y: 100 });
    fireEvent(surface(), new PointerEvent("lostpointercapture", { pointerId: 1, bubbles: true }));
    expect(drawing(editor).strokes).toEqual([]);
    const finger = { pointerId: 2, pointerType: "touch" };
    down({ ...finger, x: 200, y: 100 });
    move({ ...finger, x: 250, y: 120 });
    up({ ...finger, x: 250, y: 120 });
    expect(drawing(editor).strokes).toHaveLength(1);
  });

  test("move mode pans with one finger instead of drawing", () => {
    const editor = setup();
    fireEvent.click(screen.getByRole("radio", { name: "Move" }));
    stroke("touch", [
      [100, 100],
      [130, 90],
    ]);
    expect(drawing(editor).strokes).toEqual([]);
    expect(document.querySelector<HTMLElement>(".preview-surface")?.style.transform).toBe(
      "translate(30px, -10px) scale(1)",
    );
  });

  test("clearing the layer is one undo step", () => {
    const editor = setup();
    stroke("mouse", [[100, 100]]);
    stroke("mouse", [[200, 100]]);
    expect(drawing(editor).strokes).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Clear layer" }));
    expect(drawing(editor).strokes).toEqual([]);
    editor.undo();
    expect(drawing(editor).strokes).toHaveLength(2);
  });

  test("leaving the drawing layer restores the preview's earlier output", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Sphere" }));
    expect(screen.getByRole<HTMLInputElement>("radio", { name: "Stereogram" }).checked).toBe(true);

    fireEvent.click(screen.getByRole("radio", { name: "Depth" }));
    fireEvent.click(screen.getByRole("button", { name: "Drawing" }));
    fireEvent.click(screen.getByRole("button", { name: "Sphere" }));
    expect(screen.getByRole<HTMLInputElement>("radio", { name: "Depth" }).checked).toBe(true);
  });

  test("the drawing surface goes away when another layer is selected", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Sphere" }));
    expect(screen.queryByLabelText("Drawing surface")).toBeNull();
    expect(screen.queryByRole("radio", { name: "Draw" })).toBeNull();
  });
});
