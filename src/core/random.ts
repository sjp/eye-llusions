/**
 * Seeded pseudo-random numbers. The generator is sfc32, seeded through splitmix32. Its
 * output for a given seed is part of the recipe format: changing it changes every
 * saved image, so the golden values in the tests must never need updating.
 */

export type Random = {
  /** A uniformly distributed unsigned 32-bit integer. */
  uint32: () => number;
  /** A uniformly distributed float in [0, 1). */
  float: () => number;
};

const GOLDEN_GAMMA = 0x9e3779b9;

/** A bijective 32-bit integer finaliser with low bias (lowbias32). */
export function mix32(value: number): number {
  let h = value;
  h ^= h >>> 16;
  h = Math.imul(h, 0x21f0aaad);
  h ^= h >>> 15;
  h = Math.imul(h, 0x735a2d97);
  h ^= h >>> 15;
  return h >>> 0;
}

function assertSeed(seed: number): void {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) {
    throw new RangeError(`Seed must be an unsigned 32-bit integer, got ${String(seed)}`);
  }
}

export function createRandom(seed: number): Random {
  assertSeed(seed);
  let state = seed;
  const splitmix = (): number => {
    state = (state + GOLDEN_GAMMA) >>> 0;
    return mix32(state);
  };
  let a = splitmix();
  let b = splitmix();
  let c = splitmix();
  let counter = 1;

  const uint32 = (): number => {
    const t = (a + b + counter) >>> 0;
    counter = (counter + 1) >>> 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) >>> 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) >>> 0;
    return t;
  };
  for (let i = 0; i < 15; i++) {
    uint32();
  }

  return { uint32, float: () => uint32() / 0x1_0000_0000 };
}

/**
 * The seed of an independent sub-stream, such as one per layer or one for the texture,
 * so that consuming numbers in one part of an image never shifts another part.
 */
export function deriveSeed(seed: number, label: string): number {
  assertSeed(seed);
  let h = mix32(seed ^ GOLDEN_GAMMA);
  for (const char of label) {
    h = mix32((h ^ (char.codePointAt(0) ?? 0)) + GOLDEN_GAMMA);
  }
  return mix32(h ^ label.length);
}
