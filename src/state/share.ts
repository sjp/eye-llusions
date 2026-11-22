import { parseRecipe } from "../core/parseRecipe.ts";
import type { Layer, Recipe, Stroke } from "../core/recipe.ts";
import { STROKE_GRID } from "../core/strokes.ts";
import { compress, decompress, fromBase64Url, toBase64Url } from "./bytes.ts";

/** Bumped whenever the link payload changes in a way old decoders can't read. */
const LINK_FORMAT = 1;
const HASH_PREFIX = "#r=";
/** Links longer than this may be cut short by chat apps and mail clients. */
export const LINK_LENGTH_WARNING = 8000;
/** Caps on untrusted input, well above anything the editor can produce. */
const MAX_PAYLOAD_CHARS = 4_000_000;
const MAX_JSON_BYTES = 16 * 1024 * 1024;

/** Thrown for any share link that can't be opened; the message is shown to the user. */
export class ShareLinkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ShareLinkError";
  }
}

const BROKEN = "This link is damaged or incomplete, so the shared scene couldn't be opened.";

/** Strokes on the drawing grid travel as integer steps between points, which compress well. */
type PackedStroke = { brush: Stroke["brush"]; steps: number[] };

function packStroke(stroke: Stroke): Stroke | PackedStroke {
  const steps: number[] = [];
  const previous = [0, 0];
  for (let i = 0; i < stroke.points.length; i++) {
    const cell = stroke.points[i] / STROKE_GRID;
    if (!Number.isInteger(cell)) {
      return stroke;
    }
    steps.push(cell - previous[i % 2]);
    previous[i % 2] = cell;
  }
  return { brush: stroke.brush, steps };
}

function packLayer(layer: Layer): unknown {
  return layer.kind === "drawing" ? { ...layer, strokes: layer.strokes.map(packStroke) } : layer;
}

function isFields(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The recipe without its assets, with drawing strokes packed to compress well. */
export function packRecipe(recipe: Recipe): unknown {
  const { assets: _assets, ...shared } = recipe;
  return { ...shared, layers: shared.layers.map(packLayer) };
}

/** Expands packed strokes in place; anything malformed is left for parseRecipe to reject. */
export function unpackStrokes(input: unknown): void {
  if (!isFields(input) || !Array.isArray(input.layers)) {
    return;
  }
  for (const layer of input.layers) {
    if (!isFields(layer) || layer.kind !== "drawing" || !Array.isArray(layer.strokes)) {
      continue;
    }
    for (const stroke of layer.strokes) {
      if (!isFields(stroke) || !Array.isArray(stroke.steps)) {
        continue;
      }
      const steps: unknown[] = stroke.steps;
      if (!steps.every((step) => Number.isSafeInteger(step))) {
        continue;
      }
      const cells = [0, 0];
      stroke.points = steps.map((step, i) => {
        cells[i % 2] += Number(step);
        return cells[i % 2] * STROKE_GRID;
      });
      delete stroke.steps;
    }
  }
}

/** The recipe without its assets, compressed into the text that follows `#r=`. */
export async function encodeRecipe(recipe: Recipe): Promise<string> {
  const json = new TextEncoder().encode(JSON.stringify(packRecipe(recipe)));
  const compressed = await compress(json, "deflate-raw");
  return `${String(LINK_FORMAT)}.${toBase64Url(compressed)}`;
}

/**
 * Opens an untrusted link payload. Rejects only with ShareLinkError, whose message
 * explains the problem to the user.
 */
export async function decodeRecipe(payload: string): Promise<Recipe> {
  const dot = payload.indexOf(".");
  const version = payload.slice(0, dot);
  if (dot < 1 || !/^\d+$/.test(version)) {
    throw new ShareLinkError(BROKEN);
  }
  if (Number(version) !== LINK_FORMAT) {
    throw new ShareLinkError(
      Number(version) > LINK_FORMAT
        ? "This link was made by a newer version of Eye-llusion, so it couldn't be opened."
        : BROKEN,
    );
  }
  const body = payload.slice(dot + 1);
  if (body.length === 0 || body.length > MAX_PAYLOAD_CHARS) {
    throw new ShareLinkError(BROKEN);
  }
  let input: unknown;
  try {
    const json = await decompress(fromBase64Url(body), "deflate-raw", MAX_JSON_BYTES);
    input = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(json));
    unpackStrokes(input);
  } catch {
    throw new ShareLinkError(BROKEN);
  }
  try {
    return parseRecipe(input);
  } catch {
    throw new ShareLinkError(
      "This link doesn't describe a scene Eye-llusion can show, so it couldn't be opened.",
    );
  }
}

/** The payload of a `#r=` fragment, or undefined when the hash isn't a share link. */
export function linkPayload(hash: string): string | undefined {
  return hash.startsWith(HASH_PREFIX) ? hash.slice(HASH_PREFIX.length) : undefined;
}

/** `href` with its fragment replaced by the share link for `payload`. */
export function shareUrl(href: string, payload: string): string {
  const url = new URL(href);
  url.hash = `${HASH_PREFIX}${payload}`;
  return url.href;
}
