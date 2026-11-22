import { describe, expect, test } from "vitest";
import { cssTransform, gripOf, IDENTITY, moveGrip } from "./navigation.ts";

const surface = { centre: { x: 200, y: 150 }, width: 400, height: 300 };

/** Where a picture point, relative to the surface centre, appears on screen. */
function onScreen(view: typeof IDENTITY, x: number, y: number) {
  return {
    x: surface.centre.x + view.x + view.scale * x,
    y: surface.centre.y + view.y + view.scale * y,
  };
}

describe("navigation", () => {
  test("one finger pans", () => {
    const view = moveGrip(IDENTITY, surface, gripOf([{ x: 10, y: 10 }]), gripOf([{ x: 40, y: 0 }]));
    expect(view).toEqual({ scale: 1, x: 30, y: -10 });
  });

  test("a pinch zooms about the midpoint, which the picture follows", () => {
    const from = gripOf([
      { x: 250, y: 150 },
      { x: 350, y: 150 },
    ]);
    const to = gripOf([
      { x: 220, y: 170 },
      { x: 420, y: 170 },
    ]);
    const view = moveGrip(IDENTITY, surface, from, to);
    expect(view.scale).toBe(2);
    // The picture point that was under the first midpoint (100, 0) is under the second.
    expect(onScreen(view, 100, 0)).toEqual({ x: 320, y: 170 });
  });

  test("zoom stays between 1 and 8 and the picture can't leave the screen", () => {
    const pinch = (spread: number) =>
      moveGrip(IDENTITY, surface, { x: 200, y: 150, spread: 100 }, { x: 200, y: 150, spread });
    expect(pinch(10).scale).toBe(1);
    expect(pinch(10_000).scale).toBe(8);
    const far = moveGrip(
      IDENTITY,
      surface,
      gripOf([{ x: 0, y: 0 }]),
      gripOf([{ x: 5000, y: -5000 }]),
    );
    expect(far).toEqual({ scale: 1, x: 200, y: -150 });
  });

  test("formats a CSS transform", () => {
    expect(cssTransform({ scale: 2, x: 3, y: -4 })).toBe("translate(3px, -4px) scale(2)");
  });
});
