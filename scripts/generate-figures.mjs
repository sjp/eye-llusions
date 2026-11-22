// Draws the bundled figure depth maps from the procedural shapes below and writes them
// to src/assets/figures/ as 8-bit grey-and-alpha PNGs: grey is depth (white is near) and
// alpha is coverage. Everything is plain arithmetic and a fixed zlib level, so running
// it again produces byte-identical files.
//
//   node scripts/generate-figures.mjs

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { crc32, deflateSync } from "node:zlib";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "src", "assets", "figures");
const SIZE = 512;

/** @typedef {(x: number, y: number) => number} Sdf Signed distance, negative inside. */

/**
 * A raised part. Its height rises from `base` at the edge by up to `bulge`, reaching the
 * top `round` units in from the edge. `carve` parts lower what lies beneath instead.
 * @typedef {{ sdf: Sdf, base: number, bulge: number, round: number, profile?: "dome" | "linear", carve?: boolean }} Part
 */

/**
 * @param {number} cx
 * @param {number} cy
 * @param {number} r
 * @returns {Sdf}
 */
function circle(cx, cy, r) {
  return (x, y) => Math.hypot(x - cx, y - cy) - r;
}

/**
 * An approximate ellipse distance, good enough for gentle aspect ratios.
 * @param {number} cx
 * @param {number} cy
 * @param {number} rx
 * @param {number} ry
 * @param {number} [angle] Clockwise rotation in degrees.
 * @returns {Sdf}
 */
function ellipse(cx, cy, rx, ry, angle = 0) {
  const c = Math.cos((angle * Math.PI) / 180);
  const s = Math.sin((angle * Math.PI) / 180);
  return (x, y) => {
    const dx = x - cx;
    const dy = y - cy;
    const u = (dx * c + dy * s) / rx;
    const v = (-dx * s + dy * c) / ry;
    return (Math.hypot(u, v) - 1) * Math.min(rx, ry);
  };
}

/**
 * @param {number} ax
 * @param {number} ay
 * @param {number} bx
 * @param {number} by
 * @param {number} r
 * @returns {Sdf}
 */
function capsule(ax, ay, bx, by, r) {
  const ex = bx - ax;
  const ey = by - ay;
  const length = ex * ex + ey * ey;
  return (x, y) => {
    const t = Math.min(1, Math.max(0, ((x - ax) * ex + (y - ay) * ey) / length));
    return Math.hypot(x - ax - ex * t, y - ay - ey * t) - r;
  };
}

/**
 * Exact distance to a simple polygon.
 * @param {readonly (readonly [number, number])[]} points
 * @returns {Sdf}
 */
function polygon(points) {
  return (x, y) => {
    let nearest = Infinity;
    let inside = false;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
      const [ax, ay] = points[j];
      const [bx, by] = points[i];
      const ex = bx - ax;
      const ey = by - ay;
      const t = Math.min(1, Math.max(0, ((x - ax) * ex + (y - ay) * ey) / (ex * ex + ey * ey)));
      nearest = Math.min(nearest, Math.hypot(x - ax - ex * t, y - ay - ey * t));
      if (ay > y !== by > y && x < ((bx - ax) * (y - ay)) / (by - ay) + ax) {
        inside = !inside;
      }
    }
    return inside ? -nearest : nearest;
  };
}

/**
 * @param {Sdf} a
 * @param {Sdf} b
 * @returns {Sdf}
 */
function subtract(a, b) {
  return (x, y) => Math.max(a(x, y), -b(x, y));
}

/**
 * @param {Sdf} a
 * @param {Sdf} b
 * @returns {Sdf}
 */
function intersect(a, b) {
  return (x, y) => Math.max(a(x, y), b(x, y));
}

/**
 * The shape mirrored across the vertical centre line, joined with itself.
 * @param {Sdf} sdf
 * @returns {Sdf}
 */
function mirrored(sdf) {
  return (x, y) => Math.min(sdf(x, y), sdf(-x, y));
}

/**
 * A heart with its point at the bottom.
 * @param {number} cy Vertical centre.
 * @param {number} scale Height of the heart, roughly.
 * @returns {Sdf}
 */
function heart(cy, scale) {
  return (x, y) => {
    const px = Math.abs(x) / scale;
    const py = (cy - y) / scale + 0.5;
    if (px + py > 1) {
      return (Math.hypot(px - 0.25, py - 0.75) - Math.SQRT2 / 4) * scale;
    }
    const k = 0.5 * Math.max(px + py, 0);
    const d = Math.sqrt(Math.min(px * px + (py - 1) ** 2, (px - k) ** 2 + (py - k) ** 2));
    return d * Math.sign(px - py) * scale;
  };
}

/**
 * @param {number} points
 * @param {number} outer
 * @param {number} inner
 * @param {number} cx
 * @param {number} cy
 * @returns {[number, number][]}
 */
function starPoints(points, outer, inner, cx, cy) {
  return Array.from({ length: points * 2 }, (_, i) => {
    const angle = -Math.PI / 2 + (i * Math.PI) / points;
    const r = i % 2 === 0 ? outer : inner;
    return [cx + r * Math.cos(angle), cy + r * Math.sin(angle)];
  });
}

/**
 * @param {Sdf} sdf
 * @param {number} base
 * @param {number} bulge
 * @param {number} round
 * @param {Partial<Part>} [options]
 * @returns {Part}
 */
function part(sdf, base, bulge, round, options = {}) {
  return { sdf, base, bulge, round, ...options };
}

/**
 * @param {Sdf} sdf
 * @param {number} amount
 * @param {number} round
 * @returns {Part}
 */
function carve(sdf, amount, round) {
  return { sdf, base: 0, bulge: amount, round, carve: true };
}

/** @type {Record<string, Part[]>} */
const FIGURES = {
  heart: [part(heart(0.06, 1.55), 0.35, 0.65, 0.55)],
  star: [part(polygon(starPoints(5, 0.98, 0.42, 0, 0.08)), 0.3, 0.7, 0.34, { profile: "linear" })],
  rocket: [
    part(
      polygon([
        [-0.13, 0.62],
        [0.13, 0.62],
        [0.1, 0.78],
        [-0.1, 0.78],
      ]),
      0.3,
      0.1,
      0.05,
    ),
    part(
      mirrored(
        polygon([
          [-0.2, 0.2],
          [-0.5, 0.62],
          [-0.48, 0.8],
          [-0.16, 0.58],
        ]),
      ),
      0.25,
      0.2,
      0.08,
    ),
    part(
      intersect(ellipse(0, -0.02, 0.27, 0.9), (_x, y) => y - 0.64),
      0.4,
      0.6,
      0.27,
    ),
    part(ellipse(0, 0.9, 0.07, 0.1), 0.1, 0.15, 0.07),
    carve(circle(0, -0.2, 0.12), 0.3, 0.04),
    part(circle(0, -0.2, 0.07), 0.55, 0.15, 0.07),
  ],
  teapot: [
    part(capsule(0.42, 0.28, 0.86, -0.22, 0.075), 0.3, 0.3, 0.075),
    part(
      intersect(subtract(circle(-0.52, 0.12, 0.3), circle(-0.52, 0.12, 0.19)), (x) => x + 0.48),
      0.3,
      0.3,
      0.055,
    ),
    part(ellipse(0, 0.18, 0.56, 0.44), 0.35, 0.65, 0.45),
    part(ellipse(0, -0.3, 0.32, 0.1), 0.5, 0.2, 0.1),
    part(circle(0, -0.45, 0.085), 0.55, 0.3, 0.085),
    part(
      polygon([
        [-0.32, 0.56],
        [0.32, 0.56],
        [0.36, 0.7],
        [-0.36, 0.7],
      ]),
      0.3,
      0.15,
      0.06,
    ),
  ],
  knight: [
    part(
      polygon([
        [-0.4, 0.62],
        [-0.28, 0.28],
        [-0.22, 0.08],
        [-0.45, 0.06],
        [-0.66, 0.0],
        [-0.72, -0.14],
        [-0.58, -0.36],
        [-0.3, -0.62],
        [-0.12, -0.78],
        [-0.04, -0.96],
        [0.06, -0.78],
        [0.22, -0.7],
        [0.38, -0.48],
        [0.46, -0.15],
        [0.48, 0.2],
        [0.44, 0.62],
      ]),
      0.35,
      0.55,
      0.3,
    ),
    carve(circle(-0.22, -0.42, 0.06), 0.3, 0.05),
    carve(capsule(-0.6, -0.08, -0.5, -0.12, 0.025), 0.2, 0.025),
    part(
      polygon([
        [-0.48, 0.62],
        [0.48, 0.62],
        [0.5, 0.72],
        [-0.5, 0.72],
      ]),
      0.4,
      0.15,
      0.05,
    ),
    part(
      polygon([
        [-0.6, 0.72],
        [0.6, 0.72],
        [0.64, 0.92],
        [-0.64, 0.92],
      ]),
      0.3,
      0.25,
      0.1,
    ),
  ],
  fish: [
    part(
      polygon([
        [0.36, 0],
        [0.92, -0.42],
        [0.8, 0],
        [0.92, 0.42],
      ]),
      0.3,
      0.2,
      0.12,
    ),
    part(
      polygon([
        [-0.3, -0.3],
        [0.05, -0.62],
        [0.22, -0.28],
      ]),
      0.3,
      0.15,
      0.08,
    ),
    part(ellipse(-0.12, 0, 0.6, 0.38), 0.35, 0.65, 0.38),
    carve(
      intersect(subtract(circle(-0.3, 0, 0.27), circle(-0.3, 0, 0.24)), (x) => -0.1 - x),
      0.15,
      0.015,
    ),
    part(circle(-0.46, -0.08, 0.075), 0.75, 0.25, 0.075),
  ],
  cat: [
    part(
      mirrored(
        polygon([
          [-0.66, -0.12],
          [-0.55, -0.88],
          [-0.12, -0.46],
        ]),
      ),
      0.35,
      0.35,
      0.18,
      { profile: "linear" },
    ),
    part(ellipse(0, 0.12, 0.72, 0.6), 0.35, 0.55, 0.5),
    carve(mirrored(ellipse(-0.27, -0.02, 0.1, 0.14)), 0.35, 0.06),
    part(mirrored(circle(-0.11, 0.34, 0.14)), 0.8, 0.15, 0.1),
    part(
      polygon([
        [-0.08, 0.18],
        [0.08, 0.18],
        [0, 0.27],
      ]),
      0.9,
      0.1,
      0.04,
    ),
  ],
  butterfly: [
    part(mirrored(ellipse(-0.45, -0.3, 0.46, 0.32, -30)), 0.3, 0.35, 0.3),
    part(mirrored(ellipse(-0.33, 0.36, 0.3, 0.24, 25)), 0.3, 0.3, 0.22),
    carve(mirrored(circle(-0.55, -0.38, 0.1)), 0.2, 0.05),
    carve(mirrored(circle(-0.36, 0.4, 0.07)), 0.15, 0.04),
    part(mirrored(capsule(-0.05, -0.55, -0.25, -0.88, 0.022)), 0.5, 0.1, 0.022),
    part(capsule(0, -0.55, 0, 0.62, 0.08), 0.55, 0.45, 0.08),
  ],
};

/**
 * @param {Part} p
 * @param {number} inside Distance in from the part's edge.
 */
function partHeight(p, inside) {
  const s = Math.min(1, inside / p.round);
  const shape = p.profile === "linear" ? s : Math.sqrt(1 - (1 - s) * (1 - s));
  return p.base + p.bulge * shape;
}

/**
 * Grey-and-alpha pixels for a figure: later parts sit on top of earlier ones, so a part's
 * height replaces what's below wherever it covers.
 * @param {Part[]} parts
 */
function draw(parts) {
  const pixels = new Uint8Array(SIZE * SIZE * 2);
  const unit = 2 / SIZE;
  for (let py = 0; py < SIZE; py++) {
    const y = (py + 0.5) * unit - 1;
    for (let px = 0; px < SIZE; px++) {
      const x = (px + 0.5) * unit - 1;
      let height = 0;
      let coverage = 0;
      for (const p of parts) {
        const inside = -p.sdf(x, y);
        const alpha = Math.min(1, Math.max(0, inside / unit + 0.5));
        if (alpha <= 0) {
          continue;
        }
        const h = partHeight(p, Math.max(0, inside));
        if (p.carve === true) {
          height -= (h - p.base) * alpha;
        } else {
          height += (h - height) * alpha;
          coverage += (1 - coverage) * alpha;
        }
      }
      const i = (py * SIZE + px) * 2;
      const a = Math.round(coverage * 255);
      pixels[i] = a === 0 ? 0 : Math.round(Math.min(1, Math.max(0, height)) * 255);
      pixels[i + 1] = a;
    }
  }
  return pixels;
}

/**
 * @param {string} type
 * @param {Uint8Array} data
 */
function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "latin1");
  out.set(data, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

/** @param {Uint8Array} pixels Grey-and-alpha, SIZE × SIZE. */
function encodePng(pixels) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(SIZE, 0);
  header.writeUInt32BE(SIZE, 4);
  header.set([8, 4, 0, 0, 0], 8);
  const stride = SIZE * 2;
  const filtered = Buffer.alloc((stride + 1) * SIZE);
  for (let y = 0; y < SIZE; y++) {
    const row = y * (stride + 1);
    // The Up filter suits the smooth vertical gradients.
    filtered[row] = y === 0 ? 0 : 2;
    for (let x = 0; x < stride; x++) {
      const above = y === 0 ? 0 : pixels[(y - 1) * stride + x];
      filtered[row + 1 + x] = (pixels[y * stride + x] - above) & 0xff;
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(filtered, { level: 9 })),
    chunk("IEND", new Uint8Array(0)),
  ]);
}

mkdirSync(OUT, { recursive: true });
for (const [id, parts] of Object.entries(FIGURES)) {
  writeFileSync(join(OUT, `${id}.png`), encodePng(draw(parts)));
}
