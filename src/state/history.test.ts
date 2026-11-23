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
    const history = new History(0, { limit: 3 });
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

  describe("with a byte budget", () => {
    type Value = { name: string; assets: Uint8Array[] };
    const sizeOf = (value: Value) => value.assets.map((asset) => [asset, asset.length] as const);
    const value = (name: string, ...assets: Uint8Array[]): Value => ({ name, assets });

    function undoAll(history: History<Value>): string[] {
      const names = [history.present.name];
      while (history.undo()) {
        names.push(history.present.name);
      }
      return names;
    }

    test("drops the oldest steps once the past and present hold more than the budget", () => {
      const history = new History(value("a", new Uint8Array(40)), { sizeOf, budget: 100 });
      history.push(value("b", new Uint8Array(40)));
      history.push(value("c", new Uint8Array(40)));
      expect(undoAll(history)).toEqual(["c", "b"]);
    });

    test("counts assets that several steps share once", () => {
      const shared = new Uint8Array(60);
      const history = new History(value("a", shared), { sizeOf, budget: 100 });
      history.push(value("b", shared));
      history.push(value("c", shared, new Uint8Array(20)));
      history.push(value("d", shared, new Uint8Array(20)));
      expect(undoAll(history)).toEqual(["d", "c", "b", "a"]);
    });

    test("never drops the present, even when it alone is over the budget", () => {
      const history = new History(value("a", new Uint8Array(10)), { sizeOf, budget: 100 });
      history.push(value("b", new Uint8Array(200)));
      expect(history.present.name).toBe("b");
      expect(history.canUndo).toBe(false);
      history.push(value("c", new Uint8Array(10)));
      expect(undoAll(history)).toEqual(["c"]);
    });

    test("counts a coalescing run's latest value", () => {
      const history = new History(value("a", new Uint8Array(60)), { sizeOf, budget: 100 });
      history.push(value("b"), "drag");
      history.push(value("c", new Uint8Array(60)), "drag");
      expect(undoAll(history)).toEqual(["c"]);
    });
  });
});
