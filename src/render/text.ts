import { edgeDepth } from "../core/depth/edge.ts";
import type { Rasteriser } from "../core/depth/raster.ts";
import { FONTS } from "../core/fonts.ts";
import type { TextLayer } from "../core/recipe.ts";
import { loadFont } from "./fonts.ts";

/** Generous ink bounds around each line, in ems, so no glyph is clipped. */
const INK = { above: 1.3, below: 0.5, side: 0.3 };

/** Font size, in pixels, at which glyph advances are measured. */
const REFERENCE_SIZE = 1000;

const segmenter = typeof Intl.Segmenter === "function" ? new Intl.Segmenter(undefined) : undefined;

function graphemes(text: string): string[] {
  return segmenter === undefined
    ? Array.from(text)
    : Array.from(segmenter.segment(text), (part) => part.segment);
}

type Line = {
  glyphs: string[];
  /** Start of each glyph from the start of the line, then the line's width, in ems. */
  offsets: number[];
};

/**
 * Splits text into lines of glyphs with their advances, kerning included, measured
 * at a large size so the result barely depends on how a browser rounds them.
 */
function measureLines(context: OffscreenCanvasRenderingContext2D, text: string): Line[] {
  return text.split(/\r\n|\r|\n/).map((line) => {
    const glyphs = graphemes(line);
    const offsets = [0];
    let prefix = "";
    for (const glyph of glyphs) {
      prefix += glyph;
      offsets.push(context.measureText(prefix).width / REFERENCE_SIZE);
    }
    return { glyphs, offsets };
  });
}

/**
 * Rasterises text layers with an `OffscreenCanvas`. Each line is one line height
 * (`size`) tall with the font's em set to it; capitals sit centred within their line,
 * and the block of lines is centred on `center`. Browsers differ in how they place
 * glyphs between pixels, so each glyph is drawn on its own at a whole-pixel origin
 * and the font size is a whole number of pixels.
 */
export function createTextRasteriser(load = loadFont): Rasteriser<TextLayer> {
  let canvas: OffscreenCanvas | undefined;
  return async (layer, { width, height, target }) => {
    const family = await load(layer.font);
    if (layer.text.trim() === "") {
      return;
    }
    canvas ??= new OffscreenCanvas(1, 1);
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (context === null) {
      throw new Error("text layers need a 2D canvas");
    }
    context.font = `${String(REFERENCE_SIZE)}px "${family}"`;
    const lines = measureLines(context, layer.text);

    const capHeight = FONTS.find((font) => font.id === layer.font)?.capHeight ?? 0.7;
    const em = Math.max(1, Math.round(layer.size * height));
    const edge = layer.edge === "flat" ? 0 : layer.edgeWidth * height;
    const centreX = layer.center.x * width;
    const top = layer.center.y * height - (lines.length * em) / 2;
    const widest = Math.max(...lines.map((line) => line.offsets[line.offsets.length - 1])) * em;
    const firstBaseline = top + 0.5 * em + (capHeight * em) / 2;
    const lastBaseline = firstBaseline + (lines.length - 1) * em;
    // Beyond the margin, the canvas edge is far enough from the outline not to matter.
    const margin = Math.ceil(edge) + 2;
    const left = Math.max(-margin, Math.floor(centreX - widest / 2 - INK.side * em));
    const right = Math.min(width + margin, Math.ceil(centreX + widest / 2 + INK.side * em));
    const upper = Math.max(-margin, Math.floor(firstBaseline - INK.above * em));
    const lower = Math.min(height + margin, Math.ceil(lastBaseline + INK.below * em));
    const regionWidth = right - left;
    const regionHeight = lower - upper;
    if (regionWidth <= 0 || regionHeight <= 0) {
      return;
    }

    // Resizing clears the canvas and resets the context's state.
    canvas.width = regionWidth;
    canvas.height = regionHeight;
    context.font = `${String(em)}px "${family}"`;
    context.textAlign = "left";
    context.textBaseline = "alphabetic";
    context.fillStyle = "#fff";
    lines.forEach(({ glyphs, offsets }, index) => {
      const start = centreX - (offsets[offsets.length - 1] * em) / 2 - left;
      const baseline = Math.round(firstBaseline + index * em - upper);
      glyphs.forEach((glyph, at) => {
        context.fillText(glyph, Math.round(start + offsets[at] * em), baseline);
      });
    });

    const pixels = context.getImageData(0, 0, regionWidth, regionHeight).data;
    const coverage = new Float32Array(regionWidth * regionHeight);
    for (let i = 0; i < coverage.length; i++) {
      coverage[i] = pixels[i * 4 + 3] / 255;
    }
    const depth = new Float32Array(coverage.length);
    edgeDepth(coverage, regionWidth, regionHeight, layer.edge, edge, depth);

    const x0 = Math.max(0, left);
    const x1 = Math.min(width, right);
    for (let y = Math.max(0, upper); y < Math.min(height, upper + regionHeight); y++) {
      const from = (y - upper) * regionWidth - left;
      for (let x = x0; x < x1; x++) {
        target.coverage[y * width + x] = coverage[from + x];
        target.depth[y * width + x] = depth[from + x];
      }
    }
  };
}
