import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { FONTS } from "../core/fonts.ts";
import { defaultRecipe, type TextLayer } from "../core/recipe.ts";
import { createTextRasteriser } from "./text.ts";

/** Each glyph is a solid box 0.6 em wide, from Anton's cap height down to the baseline. */
const ADVANCE = 0.6;
const CAP = FONTS.find((font) => font.id === "anton")?.capHeight ?? 0;

type Drawn = { glyph: string; x: number; y: number; px: number };

/** A stand-in for the 2D context of an `OffscreenCanvas`, drawing glyphs as boxes. */
class FakeContext {
  font = "";
  textAlign = "";
  textBaseline = "";
  fillStyle = "";
  drawn: Drawn[] = [];
  measured: string[] = [];

  get px(): number {
    return Number(/^(\d+)px/.exec(this.font)?.[1]);
  }

  measureText(text: string) {
    this.measured.push(text);
    return { width: text.length * ADVANCE * this.px };
  }

  fillText(glyph: string, x: number, y: number) {
    this.drawn.push({ glyph, x, y, px: this.px });
  }

  getImageData(_x: number, _y: number, width: number, height: number) {
    const data = new Uint8ClampedArray(width * height * 4);
    for (const { x, y, px } of this.drawn) {
      for (let row = Math.max(0, Math.round(y - CAP * px)); row < Math.min(height, y); row++) {
        for (let col = Math.max(0, x); col < Math.min(width, x + ADVANCE * px); col++) {
          data[(row * width + col) * 4 + 3] = 255;
        }
      }
    }
    return { data };
  }
}

class FakeCanvas {
  #width: number;
  #height: number;
  readonly context = new FakeContext();

  constructor(width: number, height: number) {
    this.#width = width;
    this.#height = height;
  }

  get width() {
    return this.#width;
  }

  set width(value: number) {
    this.#width = value;
    this.context.drawn = [];
  }

  get height() {
    return this.#height;
  }

  set height(value: number) {
    this.#height = value;
    this.context.drawn = [];
  }

  getContext() {
    return this.context;
  }
}

let canvases: FakeCanvas[] = [];

beforeEach(() => {
  canvases = [];
  vi.stubGlobal(
    "OffscreenCanvas",
    class extends FakeCanvas {
      constructor(width: number, height: number) {
        super(width, height);
        canvases.push(this);
      }
    },
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const WIDTH = 200;
const HEIGHT = 100;

function layer(overrides: Partial<TextLayer> = {}): TextLayer {
  return {
    kind: "text",
    id: "text",
    name: "Text",
    visible: true,
    blend: "max",
    depth: 1,
    text: "AB",
    font: "anton",
    size: 0.2,
    center: { x: 0.5, y: 0.5 },
    edge: "flat",
    edgeWidth: 0.04,
    ...overrides,
  };
}

type Loader = (font: string) => Promise<string>;

async function rasterise(text: TextLayer, load = vi.fn<Loader>(() => Promise.resolve("Family"))) {
  const target = {
    coverage: new Float32Array(WIDTH * HEIGHT),
    depth: new Float32Array(WIDTH * HEIGHT),
  };
  const rasteriser = createTextRasteriser(load);
  const bounds = await rasteriser(text, {
    recipe: defaultRecipe(),
    width: WIDTH,
    height: HEIGHT,
    target,
  });
  return { bounds, target, load };
}

/** Rows and columns of the target with any coverage, as [first, last] each. */
function inked(coverage: Float32Array) {
  const rows: number[] = [];
  const cols: number[] = [];
  for (let i = 0; i < coverage.length; i++) {
    if (coverage[i] > 0) {
      rows.push(Math.floor(i / WIDTH));
      cols.push(i % WIDTH);
    }
  }
  return {
    rows: [Math.min(...rows), Math.max(...rows)],
    cols: [Math.min(...cols), Math.max(...cols)],
  };
}

describe("createTextRasteriser", () => {
  test("loads the layer's font and draws nothing for blank text", async () => {
    for (const text of ["", "  \n\t"]) {
      const { bounds, target, load } = await rasterise(layer({ text }));
      expect(load).toHaveBeenCalledWith("anton");
      expect(bounds).toEqual({ x0: 0, y0: 0, x1: 0, y1: 0 });
      expect(target.coverage.every((value) => value === 0)).toBe(true);
    }
  });

  test("fails when the font can't be loaded", async () => {
    const load = vi.fn<Loader>(() => Promise.reject(new Error("no font")));
    await expect(rasterise(layer(), load)).rejects.toThrow("no font");
  });

  test("centres a line on the layer's centre, a glyph at a time at whole pixels", async () => {
    const { bounds, target } = await rasterise(layer());
    const { drawn } = canvases[0].context;
    // A 20 px line, each glyph drawn on its own in the font, at its measured advance.
    expect(canvases[0].context.font).toBe('20px "Family"');
    expect(drawn.map(({ glyph }) => glyph)).toEqual(["A", "B"]);
    for (const { x, y } of drawn) {
      expect(Number.isInteger(x) && Number.isInteger(y)).toBe(true);
    }
    expect(drawn[1].x - drawn[0].x).toBe(12);

    const { rows, cols } = inked(target.coverage);
    // Two glyphs 12 px wide, centred on x = 100; capitals centred on y = 50.
    expect(cols).toEqual([88, 111]);
    expect(Math.abs((rows[0] + rows[1] + 1) / 2 - 50)).toBeLessThanOrEqual(1);
    expect(bounds?.x0).toBeLessThanOrEqual(cols[0]);
    expect(bounds?.x1).toBeGreaterThan(cols[1]);
    expect(bounds?.y0).toBeLessThanOrEqual(rows[0]);
    expect(bounds?.y1).toBeGreaterThan(rows[1]);
    // Flat text is at full depth wherever it covers.
    for (let i = 0; i < target.depth.length; i++) {
      expect(target.depth[i]).toBe(target.coverage[i] > 0 ? 1 : 0);
    }
  });

  test("stacks lines one line height apart, each centred, around the centre", async () => {
    const { target } = await rasterise(layer({ text: "ABCD\nAB" }));
    const { drawn } = canvases[0].context;
    const baselines = [...new Set(drawn.map(({ y }) => y))];
    expect(baselines).toHaveLength(2);
    expect(baselines[1] - baselines[0]).toBe(20);
    const starts = [drawn[0].x, drawn[4].x];
    // The shorter line starts two glyphs (24 px) further in, half of it each side.
    expect(starts[1] - starts[0]).toBe(12);

    const { rows } = inked(target.coverage);
    // Two 17 px tall rows of capitals 20 px apart, centred together on y = 50.
    expect(rows[1] - rows[0] + 1).toBe(37);
    expect(Math.abs((rows[0] + rows[1] + 1) / 2 - 50)).toBeLessThanOrEqual(1);
  });

  test("treats \\r\\n and \\r as line breaks too", async () => {
    await rasterise(layer({ text: "A\r\nB\rC" }));
    const baselines = new Set(canvases[0].context.drawn.map(({ y }) => y));
    expect(baselines.size).toBe(3);
  });

  test("clips text running off the canvas and keeps to the canvas in its bounds", async () => {
    const { bounds, target } = await rasterise(layer({ text: "ABCDEFGH", center: { x: 1, y: 0 } }));
    expect(bounds?.x1).toBe(WIDTH);
    expect(bounds?.y0).toBe(0);
    const { rows, cols } = inked(target.coverage);
    expect(cols[1]).toBe(WIDTH - 1);
    expect(rows[0]).toBe(0);
    expect(target.coverage).toHaveLength(WIDTH * HEIGHT);
  });

  test("draws nothing for text wholly off the canvas", async () => {
    const { bounds, target } = await rasterise(layer({ center: { x: 4, y: 0.5 } }));
    expect(bounds).toEqual({ x0: 0, y0: 0, x1: 0, y1: 0 });
    expect(target.coverage.every((value) => value === 0)).toBe(true);
  });

  test("bevels the edge of the text, lower towards its outline", async () => {
    const { target } = await rasterise(
      layer({ text: "A", size: 0.6, edge: "bevel", edgeWidth: 0.05 }),
    );
    const covered = Array.from(target.depth.filter((_, i) => target.coverage[i] > 0));
    expect(Math.max(...covered)).toBe(1);
    expect(Math.min(...covered)).toBeLessThan(0.5);
  });

  test("measures a text once and reuses it while it is among the recent ones", async () => {
    const rasteriser = createTextRasteriser(() => Promise.resolve("Family"));
    const context = {
      recipe: defaultRecipe(),
      width: WIDTH,
      height: HEIGHT,
      target: {
        coverage: new Float32Array(WIDTH * HEIGHT),
        depth: new Float32Array(WIDTH * HEIGHT),
      },
    };
    await rasteriser(layer(), context);
    const fake = canvases[0].context;
    expect(fake.measured).toEqual(["A", "AB"]);
    await rasteriser(layer({ size: 0.4 }), context);
    expect(fake.measured).toHaveLength(2);

    for (let i = 0; i < 16; i++) {
      await rasteriser(layer({ text: `T${String(i)}` }), context);
    }
    fake.measured = [];
    await rasteriser(layer(), context);
    expect(fake.measured).toEqual(["A", "AB"]);
  });
});
