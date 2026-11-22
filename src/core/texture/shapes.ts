import { mix32 } from "../random.ts";
import { cellHash, UINT32_RANGE } from "./context.ts";
import { fractalNoise } from "./noise.ts";

const GLYPHS = 4;
const DOT = 0;
const RING = 1;
const TRIANGLE = 2;

/** Glyph radii, as fractions of the spacing. */
const MIN_RADIUS = 0.25;
const MAX_RADIUS = 0.6;

const TAU = 2 * Math.PI;
const STAR_POINTS = 5;
const STAR_SECTOR = TAU / STAR_POINTS;
const STAR_INNER = 0.42;
/** The star's inner vertex, next to the outer one at (1, 0). */
const STAR_IX = STAR_INNER * Math.cos(STAR_SECTOR / 2);
const STAR_IY = STAR_INNER * Math.sin(STAR_SECTOR / 2);

/** Whether a point in the glyph's frame, scaled so the glyph's radius is 1, is inside it. */
function insideGlyph(glyph: number, u: number, v: number, distance: number): boolean {
  switch (glyph) {
    case DOT:
      return distance < 0.64;
    case RING:
      return distance > 0.36;
    case TRIANGLE:
      // Three edges at the inradius, 1/2, facing 0°, 120° and 240°.
      return u < 0.5 && -0.5 * u + 0.866_025 * v < 0.5 && -0.5 * u - 0.866_025 * v < 0.5;
    default: {
      let angle = Math.atan2(v, u) % STAR_SECTOR;
      if (angle < 0) {
        angle += STAR_SECTOR;
      }
      if (angle > STAR_SECTOR / 2) {
        angle = STAR_SECTOR - angle;
      }
      const r = Math.sqrt(distance);
      const px = r * Math.cos(angle);
      const py = r * Math.sin(angle);
      // Inside when on the centre's side of the edge from (1, 0) to the inner vertex.
      return (STAR_IX - 1) * py - STAR_IY * (px - 1) >= 0;
    }
  }
}

/**
 * Small dots, rings, triangles and stars scattered over a soft noise background. Each
 * square of `spacing` pixels holds at most one glyph, with probability `density`, at a
 * random position, rotation and size. Glyphs take values near 0 or 1 and the
 * background stays in between, so they stand out with any palette.
 */
export function scatteredShapes(
  keys: { glyph: number; background: readonly number[] },
  spacing: number,
  density: number,
): (x: number, y: number) => number {
  const background = fractalNoise(keys.background, spacing);
  const threshold = density * UINT32_RANGE;
  return (x, y) => {
    const gx = x / spacing;
    const gy = y / spacing;
    // The covering glyph with the highest hash is drawn on top.
    let top = -1;
    // Only squares whose glyphs can reach this point: centres lie inside their square.
    for (let j = Math.floor(gy - MAX_RADIUS); j <= Math.floor(gy + MAX_RADIUS); j++) {
      for (let i = Math.floor(gx - MAX_RADIUS); i <= Math.floor(gx + MAX_RADIUS); i++) {
        const hash = cellHash(keys.glyph, i, j);
        if (hash >= threshold) {
          continue;
        }
        const detail = mix32(hash);
        const radius = MIN_RADIUS + (MAX_RADIUS - MIN_RADIUS) * ((detail & 0xff) / 0xff);
        const dx = gx - (i + ((detail >>> 8) & 0xff) / 0x100);
        const dy = gy - (j + ((detail >>> 16) & 0xff) / 0x100);
        const distance = (dx * dx + dy * dy) / (radius * radius);
        if (distance >= 1) {
          continue;
        }
        const turn = mix32(detail);
        if (turn <= top) {
          continue;
        }
        const angle = (turn / UINT32_RANGE) * TAU;
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        const u = (dx * cos + dy * sin) / radius;
        const v = (dy * cos - dx * sin) / radius;
        if (insideGlyph((detail >>> 24) % GLYPHS, u, v, distance)) {
          top = turn;
        }
      }
    }
    if (top < 0) {
      return 0.3 + 0.4 * background(x, y);
    }
    const shade = mix32(top) / UINT32_RANGE;
    return shade < 0.5 ? shade * 0.4 : 0.6 + shade * 0.4;
  };
}
