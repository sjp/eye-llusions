import { describe, expect, test } from "vitest";
import { History } from "./history.ts";

describe("History", () => {
  test("undoes and redoes pushed values in order", () => {
    const history = new History("a");
    history.push("b");
    history.push("c");
    expect(history.undo()).toBe(true);
    expect(history.present).toBe("b");
    expect(history.undo()).toBe(true);
    expect(history.present).toBe("a");
    expect(history.undo()).toBe(false);
    expect(history.canUndo).toBe(false);
    expect(history.redo()).toBe(true);
    expect(history.redo()).toBe(true);
    expect(history.present).toBe("c");
    expect(history.redo()).toBe(false);
    expect(history.canRedo).toBe(false);
  });

  test("a push clears the redo stack", () => {
    const history = new History(0);
    history.push(1);
    history.undo();
    history.push(2);
    expect(history.canRedo).toBe(false);
    history.undo();
    expect(history.present).toBe(0);
  });

  test("ignores pushes of the current value", () => {
    const history = new History(1);
    history.push(1);
    expect(history.canUndo).toBe(false);
  });

  test("coalesces a run with the same key into one step until sealed", () => {
    const history = new History(0);
    history.push(1, "drag");
    history.push(2, "drag");
    history.push(3, "drag");
    expect(history.coalescing).toBe(true);
    history.seal();
    expect(history.coalescing).toBe(false);
    history.push(4, "drag");
    history.undo();
    expect(history.present).toBe(3);
    history.undo();
    expect(history.present).toBe(0);
    expect(history.canUndo).toBe(false);
  });

  test("a different key or no key starts a new step", () => {
    const history = new History(0);
    history.push(1, "a");
    history.push(2, "b");
    history.push(3);
    history.push(4, "b");
    expect([history.undo(), history.present]).toEqual([true, 3]);
    expect([history.undo(), history.present]).toEqual([true, 2]);
    expect([history.undo(), history.present]).toEqual([true, 1]);
  });

  test("undo ends a coalescing run", () => {
    const history = new History(0);
    history.push(1, "drag");
    history.undo();
    history.push(2, "drag");
    history.push(3, "drag");
    history.undo();
    expect(history.present).toBe(0);
  });

  test("keeps at most the limit of undo steps", () => {
    const history = new History(0, 3);
    for (let i = 1; i <= 5; i++) {
      history.push(i);
    }
    let steps = 0;
    while (history.undo()) {
      steps++;
    }
    expect(steps).toBe(3);
    expect(history.present).toBe(2);
  });
});
