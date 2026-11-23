// Draws the site's link preview and app icons into public/: preview.png, a 1200 × 630
// stereogram of a gallery scene for link unfurls, and the favicon's design as opaque PNG
// icons for home screens and the web app manifest. Everything is plain arithmetic and a
// fixed zlib level, so running it again produces byte-identical files.
//
//   node scripts/generate-site-images.ts

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { crc32, deflateSync, inflateSync } from "node:zlib";
import { compositeDepth, CORE_RASTERISERS } from "../src/core/depth/composite.ts";
import { prepareFigure, rasteriseFigure, type FigureImage } from "../src/core/depth/figure.ts";
import { rasteriseSample } from "../src/core/depth/sample.ts";
import type { Recipe, SampleLayer } from "../src/core/recipe.ts";
import { renderStereogram } from "../src/core/stereogram.ts";
import { buildSampler } from "../src/core/texture/sampler.ts";
import { EXPORT_OVERSAMPLE } from "../src/render/resolution.ts";
import { GALLERY } from "../src/ui/gallery/samples.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC = join(ROOT, "public");
const FIGURES = join(ROOT, "src", "assets", "figures");

const PREVIEW_SAMPLE = "lift-off";
const PREVIEW_WIDTH = 1200;
const PREVIEW_HEIGHT = 630;

function chunk(type: string, data: Uint8Array): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "latin1");
  out.set(data, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

/** An 8-bit RGB PNG of opaque RGBA pixels, each row Sub filtered. */
function encodeRgbPng(rgba: Uint8ClampedArray, width: number, height: number): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8);
  const stride = width * 3;
  const filtered = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (stride + 1);
    filtered[row] = 1;
    for (let x = 0; x < width; x++) {
      for (let c = 0; c < 3; c++) {
        const value = rgba[(y * width + x) * 4 + c];
        const left = x === 0 ? 0 : rgba[(y * width + x - 1) * 4 + c];
        filtered[row + 1 + x * 3 + c] = (value - left) & 0xff;
      }
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(filtered, { level: 9 })),
    chunk("IEND", new Uint8Array(0)),
  ]);
}

/**
 * Decodes a bundled figure: a square, non-interlaced 8-bit grey-and-alpha PNG, as
 * written by generate-figures.mjs. Returns RGBA pixels with grey in each colour channel.
 */
function decodeFigurePng(png: Buffer): { rgba: Uint8Array; size: number } {
  let offset = 8;
  let size = 0;
  const data: Buffer[] = [];
  while (offset < png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.toString("latin1", offset + 4, offset + 8);
    const body = png.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      size = body.readUInt32BE(0);
      if (body.readUInt32BE(4) !== size || body[8] !== 8 || body[9] !== 4 || body[12] !== 0) {
        throw new Error("Figures must be square, 8-bit grey-and-alpha and not interlaced");
      }
    } else if (type === "IDAT") {
      data.push(body);
    }
    offset += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(data));
  const stride = size * 2;
  const pixels = new Uint8Array(stride * size);
  for (let y = 0; y < size; y++) {
    const filter = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x++) {
      const value = raw[y * (stride + 1) + 1 + x];
      const left = x < 2 ? 0 : pixels[y * stride + x - 2];
      const up = y === 0 ? 0 : pixels[(y - 1) * stride + x];
      const upLeft = x < 2 || y === 0 ? 0 : pixels[(y - 1) * stride + x - 2];
      let predicted = 0;
      if (filter === 1) {
        predicted = left;
      } else if (filter === 2) {
        predicted = up;
      } else if (filter === 3) {
        predicted = (left + up) >> 1;
      } else if (filter === 4) {
        const p = left + up - upLeft;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - upLeft);
        predicted = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
      }
      pixels[y * stride + x] = (value + predicted) & 0xff;
    }
  }
  const rgba = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    rgba.fill(pixels[i * 2], i * 4, i * 4 + 3);
    rgba[i * 4 + 3] = pixels[i * 2 + 1];
  }
  return { rgba, size };
}

async function renderPreview(): Promise<Buffer> {
  const sample = GALLERY.find((candidate) => candidate.id === PREVIEW_SAMPLE);
  if (sample === undefined) {
    throw new Error(`No gallery sample is called ${PREVIEW_SAMPLE}`);
  }
  const recipe: Recipe = { ...sample.recipe, aspect: PREVIEW_WIDTH / PREVIEW_HEIGHT };
  const figures = new Map<string, FigureImage>();
  const depth = await compositeDepth(recipe, PREVIEW_WIDTH, PREVIEW_HEIGHT, {
    ...CORE_RASTERISERS,
    sample: (layer: SampleLayer, context) => {
      if (layer.shape.type !== "figure") {
        return rasteriseSample(layer, context);
      }
      const id = layer.shape.figure;
      let figure = figures.get(id);
      if (figure === undefined) {
        const { rgba, size } = decodeFigurePng(readFileSync(join(FIGURES, `${id}.png`)));
        figure = prepareFigure(rgba, size);
        figures.set(id, figure);
      }
      return rasteriseFigure(layer, context, figure);
    },
  });
  const pixels = renderStereogram({
    depth,
    width: PREVIEW_WIDTH,
    height: PREVIEW_HEIGHT,
    repeats: recipe.view.repeats,
    depthOfField: recipe.view.depthOfField,
    mode: recipe.view.mode,
    oversample: EXPORT_OVERSAMPLE,
    sample: buildSampler(recipe, PREVIEW_WIDTH, PREVIEW_HEIGHT),
  });
  return encodeRgbPng(pixels, PREVIEW_WIDTH, PREVIEW_HEIGHT);
}

type Point = readonly [number, number];
type Colour = readonly [number, number, number];

/** Points along a cubic Bézier curve, excluding its start. */
function cubic(from: Point, c1: Point, c2: Point, to: Point, steps = 32): Point[] {
  return Array.from({ length: steps }, (_, i) => {
    const t = (i + 1) / steps;
    const s = 1 - t;
    const a = s * s * s;
    const b = 3 * s * s * t;
    const c = 3 * s * t * t;
    const d = t * t * t;
    return [
      a * from[0] + b * c1[0] + c * c2[0] + d * to[0],
      a * from[1] + b * c1[1] + c * c2[1] + d * to[1],
    ];
  });
}

/** The favicon's eye outline, a closed loop of points in its 32-unit box. */
function eye(dx: number): Point[] {
  const p = (x: number, y: number): Point => [x + dx, y];
  return [
    p(2, 16),
    ...cubic(p(2, 16), p(5, 11), p(8, 9), p(11, 9)),
    ...cubic(p(11, 9), p(14, 9), p(17, 11), p(20, 16)),
    ...cubic(p(20, 16), p(17, 21), p(14, 23), p(11, 23)),
    ...cubic(p(11, 23), p(8, 23), p(5, 21), p(2, 16)),
  ];
}

function distanceToLoop(points: readonly Point[], x: number, y: number): number {
  let nearest = Infinity;
  for (let i = 1; i < points.length; i++) {
    const [ax, ay] = points[i - 1];
    const [bx, by] = points[i];
    const ex = bx - ax;
    const ey = by - ay;
    const t = Math.min(1, Math.max(0, ((x - ax) * ex + (y - ay) * ey) / (ex * ex + ey * ey)));
    nearest = Math.min(nearest, Math.hypot(x - ax - ex * t, y - ay - ey * t));
  }
  return nearest;
}

const TEAL: Colour = [0x4f, 0xd1, 0xc5];
const PINK: Colour = [0xf4, 0x72, 0xb6];

/** The favicon drawn on an opaque black square `size` pixels across. */
function renderIcon(size: number): Buffer {
  const left = eye(0);
  const right = eye(10);
  // Signed distances in favicon units, negative inside, painted bottom to top.
  const marks: [(x: number, y: number) => number, Colour][] = [
    [(x, y) => distanceToLoop(left, x, y) - 1, TEAL],
    [(x, y) => distanceToLoop(right, x, y) - 1, PINK],
    [(x, y) => Math.hypot(x - 11, y - 16) - 2.5, TEAL],
    [(x, y) => Math.hypot(x - 21, y - 16) - 2.5, PINK],
  ];
  const unit = 32 / size;
  const pixels = new Uint8ClampedArray(size * size * 4);
  for (let py = 0; py < size; py++) {
    const y = (py + 0.5) * unit;
    for (let px = 0; px < size; px++) {
      const x = (px + 0.5) * unit;
      let colour = [0, 0, 0];
      for (const [distance, paint] of marks) {
        const alpha = Math.min(1, Math.max(0, 0.5 - distance(x, y) / unit));
        colour = colour.map((value, c) => value + (paint[c] - value) * alpha);
      }
      const i = (py * size + px) * 4;
      pixels.set([...colour.map((value) => Math.round(value)), 255], i);
    }
  }
  return encodeRgbPng(pixels, size, size);
}

writeFileSync(join(PUBLIC, "preview.png"), await renderPreview());
writeFileSync(join(PUBLIC, "apple-touch-icon.png"), renderIcon(180));
writeFileSync(join(PUBLIC, "icon-192.png"), renderIcon(192));
writeFileSync(join(PUBLIC, "icon-512.png"), renderIcon(512));
