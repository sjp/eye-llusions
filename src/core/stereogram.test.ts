import { describe, expect, test } from "vitest";
import { renderStereogram, type StereogramOptions } from "./stereogram.ts";

const WIDTH = 400;
const HEIGHT = 4;
const REPEATS = 8;
const MU = 1 / 3;
/** Eye separation in pixels. */
const EYE = (2 * WIDTH) / REPEATS;
const FAR_PERIOD = EYE / 2;
const NEAR_PERIOD = Math.round(((1 - MU) * EYE) / (2 - MU));

/** A distinct opaque colour for every sample position in a row. */
function uniqueSample(x: number, y: number): number {
  const index = Math.round(x * 4);
  return (((index & 0xff) << 24) | (((index >> 8) & 0xff) << 16) | ((y & 0xff) << 8) | 0xff) >>> 0;
}

function render(
  depth: Float32Array,
  overrides: Partial<StereogramOptions> = {},
): Uint8ClampedArray {
  return renderStereogram({
    depth,
    width: WIDTH,
    height: HEIGHT,
    repeats: REPEATS,
    depthOfField: MU,
    mode: "wall",
    oversample: 1,
    sample: uniqueSample,
    ...overrides,
  });
}

function pixel(image: Uint8ClampedArray, x: number, y: number, width = WIDTH): number {
  const i = (y * width + x) * 4;
  return ((image[i] << 24) | (image[i + 1] << 16) | (image[i + 2] << 8) | image[i + 3]) >>> 0;
}

function flat(value: number): Float32Array {
  return new Float32Array(WIDTH * HEIGHT).fill(value);
}

/** Depth 0 everywhere except a near rectangle covering columns [x0, x1). */
function withRect(x0: number, x1: number): Float32Array {
  const depth = flat(0);
  for (let y = 0; y < HEIGHT; y++) {
    depth.fill(1, y * WIDTH + x0, y * WIDTH + x1);
  }
  return depth;
}

function smallestPeriod(image: Uint8ClampedArray, y: number): number {
  for (let period = 1; period < WIDTH; period++) {
    let periodic = true;
    for (let x = 0; x + period < WIDTH && periodic; x++) {
      periodic = pixel(image, x, y) === pixel(image, x + period, y);
    }
    if (periodic) {
      return period;
    }
  }
  return WIDTH;
}

/**
 * Columns of row 0 whose own pair of pixels doesn't match, so the point there is
 * hidden from an eye.
 */
function unconstrained(depth: Float32Array, mode: "wall" | "cross"): number[] {
  const image = render(depth, { mode });
  const eye = mode === "cross" ? ((2 - MU) * WIDTH) / ((1 - MU) * REPEATS) : EYE;
  const hidden: number[] = [];
  for (let x = 0; x < WIDTH; x++) {
    const z = mode === "cross" ? 1 - depth[x] : depth[x];
    const s = Math.round(((1 - MU * z) * eye) / (2 - MU * z));
    const left = x - (s >> 1);
    if (left >= 0 && left + s < WIDTH && pixel(image, left, 0) !== pixel(image, left + s, 0)) {
      hidden.push(x);
    }
  }
  return hidden;
}

describe("renderStereogram", () => {
  test("repeats exactly with half the eye separation over a flat far plane", () => {
    const image = render(flat(0));
    for (let y = 0; y < HEIGHT; y++) {
      expect(smallestPeriod(image, y)).toBe(FAR_PERIOD);
    }
  });

  test("repeats with a shorter period over a nearer flat plane", () => {
    const image = render(flat(1));
    expect(NEAR_PERIOD).toBeLessThan(FAR_PERIOD);
    for (let y = 0; y < HEIGHT; y++) {
      expect(smallestPeriod(image, y)).toBe(NEAR_PERIOD);
    }
  });

  test("links pixels by the near separation inside a raised square", () => {
    const image = render(withRect(150, 250));
    const half = NEAR_PERIOD / 2;
    for (let y = 0; y < HEIGHT; y++) {
      for (let x = 150; x < 250; x++) {
        expect(pixel(image, x - half, y)).toBe(pixel(image, x + half, y));
      }
      for (let x = 0; x + FAR_PERIOD < 140; x++) {
        expect(pixel(image, x, y)).toBe(pixel(image, x + FAR_PERIOD, y));
      }
    }
  });

  test("leaves background hidden behind a near edge unconstrained", () => {
    const image = render(withRect(150, 250));
    // Seen from the left eye, the point just right of the square is behind it.
    const centre = 252;
    expect(pixel(image, centre - FAR_PERIOD / 2, 0)).not.toBe(
      pixel(image, centre + FAR_PERIOD / 2, 0),
    );
  });

  test("matches the inverted wall-eyed render in cross-eyed mode where nothing is hidden", () => {
    const depth = new Float32Array(WIDTH * HEIGHT);
    for (let i = 0; i < depth.length; i++) {
      depth[i] = (i % WIDTH) / WIDTH;
    }
    const inverted = depth.map((d) => 1 - d);
    const sameEyeRepeats = (2 * REPEATS * (1 - MU)) / (2 - MU);
    expect(render(depth, { mode: "cross" })).toEqual(render(inverted, { repeats: sameEyeRepeats }));
  });

  test("leaves only the background beside a box edge unconstrained: 8 wall-eyed, 3 cross-eyed (was 10 of the box itself)", () => {
    const depth = withRect(150, 250);
    for (const [mode, perSide] of [
      ["wall", 8],
      ["cross", 3],
    ] as const) {
      const hidden = unconstrained(depth, mode);
      expect(hidden.filter((x) => x < 150)).toHaveLength(perSide);
      expect(hidden.filter((x) => x >= 250)).toHaveLength(perSide);
      expect(hidden.every((x) => x >= 150 - perSide && x < 250 + perSide)).toBe(true);
      expect(hidden.some((x) => x >= 150 && x < 250)).toBe(false);
    }
  });

  test("leaves none of a cross-eyed sphere unconstrained (was 6 rim points)", () => {
    const depth = new Float32Array(WIDTH * HEIGHT);
    for (let i = 0; i < depth.length; i++) {
      const u = ((i % WIDTH) - 200) / 80;
      depth[i] = u * u < 1 ? Math.sqrt(1 - u * u) : 0;
    }
    const hidden = unconstrained(depth, "cross");
    expect(hidden.filter((x) => depth[x] > 0)).toEqual([]);
  });

  test("gives the background the same strip width in both modes", () => {
    for (const mode of ["wall", "cross"] as const) {
      expect(smallestPeriod(render(flat(0), { mode }), 0)).toBe(WIDTH / REPEATS);
      const image = render(withRect(250, 350), { mode });
      for (let x = 0; x + FAR_PERIOD < 200; x++) {
        expect(pixel(image, x, 1)).toBe(pixel(image, x + FAR_PERIOD, 1));
      }
    }
    expect(() => render(flat(0), { mode: "cross", depthOfField: 1 })).toThrow(RangeError);
  });

  test("is deterministic and fills a given output buffer", () => {
    const depth = withRect(100, 300);
    const out = new Uint8ClampedArray(WIDTH * HEIGHT * 4);
    const first = render(depth, { out });
    expect(first).toBe(out);
    expect(render(depth)).toEqual(first);
  });

  test("samples each pixel group at its member nearest the middle", () => {
    const middle = WIDTH / 2 - FAR_PERIOD / 2;
    // Shapes on either side don't move the texture in the middle strip.
    for (const depth of [flat(0), withRect(30, 80), withRect(320, 370)]) {
      const image = render(depth);
      for (let x = middle; x < middle + FAR_PERIOD; x++) {
        expect(pixel(image, x, 2)).toBe(uniqueSample(x, 2));
      }
    }
    const image = render(flat(0));
    expect(pixel(image, 0, 2)).not.toBe(uniqueSample(0, 2));
    expect(pixel(image, WIDTH - 1, 2)).not.toBe(uniqueSample(WIDTH - 1, 2));
  });

  test("averages oversampled pixels down to the output width", () => {
    const image = render(flat(0), { oversample: 2 });
    expect(image.length).toBe(WIDTH * HEIGHT * 4);
    expect(smallestPeriod(image, 1)).toBe(FAR_PERIOD);

    const grey = render(flat(0), {
      oversample: 4,
      sample: (x) => (Math.round(x * 4) % 2 === 0 ? 0x000000ff : 0x646464ff),
    });
    expect([...grey.subarray(0, 4)]).toEqual([50, 50, 50, 255]);
  });

  test("rendering in bands of rows gives the same pixels as one pass", () => {
    const depth = withRect(150, 250);
    for (const mode of ["wall", "cross"] as const) {
      const whole = render(depth, { mode, oversample: 2 });
      const banded = new Uint8ClampedArray(WIDTH * HEIGHT * 4);
      for (const [startRow, endRow] of [
        [0, 1],
        [1, 3],
        [3, 3],
        [3, 4],
      ]) {
        render(depth, { mode, oversample: 2, out: banded, startRow, endRow });
      }
      expect(banded).toEqual(whole);
    }
  });

  test("leaves rows outside the band alone", () => {
    const out = new Uint8ClampedArray(WIDTH * HEIGHT * 4);
    render(flat(0), { out, startRow: 1, endRow: 2 });
    expect(out.subarray(0, WIDTH * 4).every((value) => value === 0)).toBe(true);
    expect(out.subarray(WIDTH * 4, WIDTH * 8).some((value) => value !== 0)).toBe(true);
    expect(out.subarray(WIDTH * 8).every((value) => value === 0)).toBe(true);
  });

  test("finds the same hidden points with or without the prefilter", () => {
    const rows = 6;
    let state = 7;
    const random = (): number => {
      state = (Math.imul(state, 1103515245) + 12345) >>> 0;
      return state / 2 ** 32;
    };
    const scenes: Record<string, (x: number, y: number) => number> = {
      specks: () => 0,
      dome: (x, y) => Math.max(0, 1 - ((x - 200) / 120) ** 2 - ((y - 3) / 4) ** 2),
      steps: (x) => Math.floor(x / 50) / 8,
      noise: () => random(),
      boxes: (x, y) => (x % 130 < 40 + y * 5 ? 0.9 : 0.2),
    };
    for (const [name, at] of Object.entries(scenes)) {
      const depth = new Float32Array(WIDTH * rows);
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < WIDTH; x++) {
          depth[y * WIDTH + x] = at(x, y);
        }
      }
      if (name === "specks") {
        for (let y = 0; y < rows; y++) {
          depth[y * WIDTH + Math.floor(random() * WIDTH)] = 1;
        }
      }
      for (const [mode, repeats, depthOfField] of [
        ["wall", 8, 1 / 3],
        ["wall", 8, 0.9],
        ["wall", 2, 0.9],
        ["wall", 12, 0.05],
        ["cross", 8, 1 / 3],
        ["cross", 3, 0.5],
      ] as const) {
        for (const oversample of [1, 2]) {
          const options = { height: rows, mode, repeats, depthOfField, oversample };
          const scan = render(depth, { ...options, hiddenSurface: "scan" });
          expect(render(depth, { ...options, hiddenSurface: "prefilter" })).toEqual(scan);
          expect(render(depth, { ...options, hiddenSurface: "auto" })).toEqual(scan);
        }
      }
    }
  });

  test("oversampling keeps the far plane's period and fills every pixel across depth edges", () => {
    const depth = withRect(150, 250);
    for (const mode of ["wall", "cross"] as const) {
      for (const oversample of [2, 4]) {
        const image = render(depth, { mode, oversample });
        for (let i = 3; i < image.length; i += 4) {
          expect(image[i]).toBe(255);
        }
        // Left of the square, the far plane links pixels a whole far strip apart.
        for (let x = 0; x + FAR_PERIOD < 140; x++) {
          expect(pixel(image, x, 1)).toBe(pixel(image, x + FAR_PERIOD, 1));
        }
      }
    }
  });

  test("reads NaN and -Infinity depth as far and Infinity as near", () => {
    expect(render(flat(Number.NaN))).toEqual(render(flat(0)));
    expect(render(flat(-Infinity))).toEqual(render(flat(0)));
    expect(render(flat(Infinity))).toEqual(render(flat(1)));
    expect(render(flat(-0.5))).toEqual(render(flat(0)));
    expect(render(flat(1.5))).toEqual(render(flat(1)));
  });

  test("a non-finite depth value doesn't change its neighbours", () => {
    for (const mode of ["wall", "cross"] as const) {
      for (const oversample of [1, 2]) {
        const near = withRect(150, 250);
        const reference = withRect(150, 250);
        for (let y = 0; y < HEIGHT; y++) {
          near[y * WIDTH + 200] = Infinity;
          near[y * WIDTH + 50] = Number.NaN;
          reference[y * WIDTH + 50] = 0;
        }
        expect(render(near, { mode, oversample })).toEqual(render(reference, { mode, oversample }));
      }
    }
  });

  test("rejects inconsistent sizes", () => {
    expect(() => render(flat(0), { startRow: 2, endRow: 1 })).toThrow(RangeError);
    expect(() => render(flat(0), { endRow: HEIGHT + 1 })).toThrow(RangeError);
    expect(() => render(flat(0), { startRow: 0.5 })).toThrow(RangeError);
    expect(() => render(new Float32Array(10))).toThrow(RangeError);
    expect(() => render(flat(0), { out: new Uint8ClampedArray(4) })).toThrow(RangeError);
    expect(() => render(flat(0), { oversample: 1.5 })).toThrow(RangeError);
  });
});
