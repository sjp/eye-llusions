import { referencedAssets } from "../core/assets.ts";
import { insertChunk, readChunks } from "../core/png/chunks.ts";
import { decodeITxt, encodeITxt } from "../core/png/itxt.ts";
import { migrateRecipe } from "../core/migrateRecipe.ts";
import { parseRecipe, RECIPE_LIMITS } from "../core/parseRecipe.ts";
import type { Asset, Recipe } from "../core/recipe.ts";
import { compress, decompress, fromBase64Url, toBase64Url } from "./bytes.ts";
import { packRecipe, unpackStrokes } from "./share.ts";

const KEYWORD = "eye-llusion-recipe";
/** Bumped whenever the embedded project changes in a way old readers can't open. */
const FILE_FORMAT = 1;
/** Cap on the embedded text once inflated: the asset limit in base64, plus the recipe. */
const MAX_TEXT_BYTES = 100 * 1024 * 1024;

type ProblemKind = "none" | "broken" | "newer" | "invalid";

const MESSAGES: Record<ProblemKind, string> = {
  none: "This image doesn't contain an Eye-llusion project.",
  broken: "This image's Eye-llusion project is damaged, so it couldn't be opened.",
  newer:
    "This image was saved by a newer version of Eye-llusion, so its project couldn't be opened.",
  invalid: "This image's project isn't one Eye-llusion can open.",
};

/** A file that can't be opened as a project. The message is shown to the user. */
export class ProjectFileError extends Error {
  readonly kind: ProblemKind;

  constructor(kind: ProblemKind) {
    super(MESSAGES[kind]);
    this.name = "ProjectFileError";
    this.kind = kind;
  }
}

type EncodedAsset = { format: Asset["format"]; width: number; height: number; data: string };

const channels = (format: Asset["format"]): number => (format === "gray" ? 1 : 4);

/**
 * PNG's Sub filter: each byte becomes its difference from the same channel of the
 * pixel to its left, which deflate compresses much better for photos and gradients.
 */
function subFilter(data: Uint8Array, rowBytes: number, step: number): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i++) {
    out[i] = i % rowBytes < step ? data[i] : data[i] - data[i - step];
  }
  return out;
}

function unSubFilter(data: Uint8Array<ArrayBuffer>, rowBytes: number, step: number): void {
  for (let i = 0; i < data.length; i++) {
    if (i % rowBytes >= step) {
      data[i] += data[i - step];
    }
  }
}

async function encodeAsset({ format, width, height, data }: Asset): Promise<EncodedAsset> {
  const step = channels(format);
  const packed = await compress(subFilter(data, width * step, step), "deflate-raw");
  return { format, width, height, data: toBase64Url(packed) };
}

/**
 * The PNG file with the recipe, including its assets, embedded in an iTXt chunk. Assets
 * are filtered and deflated byte arrays, so a grey image costs one byte per pixel at most.
 */
export async function embedProject(
  png: Uint8Array,
  recipe: Recipe,
): Promise<Uint8Array<ArrayBuffer>> {
  const assets: Record<string, EncodedAsset> = {};
  for (const [id, asset] of Object.entries(recipe.assets)) {
    assets[id] = await encodeAsset(asset);
  }
  const project = { format: FILE_FORMAT, recipe: packRecipe(recipe), assets };
  const text = await compress(new TextEncoder().encode(JSON.stringify(project)), "deflate");
  return insertChunk(png, encodeITxt({ keyword: KEYWORD, compressed: true, text }));
}

function isFields(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function side(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 1 && Number(value) <= RECIPE_LIMITS.assetSide;
}

/** Inflates the assets with IDs in `wanted`, checking their sizes first. */
async function decodeAssets(
  input: unknown,
  wanted: ReadonlySet<string>,
): Promise<Record<string, Asset>> {
  if (!isFields(input) || Object.keys(input).length > RECIPE_LIMITS.assets) {
    throw new ProjectFileError("invalid");
  }
  const assets: [string, Asset][] = [];
  let total = 0;
  for (const [id, value] of Object.entries(input)) {
    if (!wanted.has(id)) {
      continue;
    }
    if (
      !isFields(value) ||
      (value.format !== "gray" && value.format !== "rgba") ||
      !side(value.width) ||
      !side(value.height) ||
      typeof value.data !== "string"
    ) {
      throw new ProjectFileError("invalid");
    }
    const { format, width, height } = value;
    const step = channels(format);
    const size = width * height * step;
    total += size;
    if (total > RECIPE_LIMITS.assetBytesTotal) {
      throw new ProjectFileError("invalid");
    }
    let data: Uint8Array<ArrayBuffer>;
    try {
      data = await decompress(fromBase64Url(value.data), "deflate-raw", size);
    } catch {
      throw new ProjectFileError("broken");
    }
    if (data.length !== size) {
      throw new ProjectFileError("broken");
    }
    unSubFilter(data, width * step, step);
    assets.push([id, { format, width, height, data }]);
  }
  return Object.fromEntries(assets);
}

function projectText(bytes: Uint8Array): Uint8Array<ArrayBuffer> | undefined {
  let chunks;
  try {
    chunks = readChunks(bytes);
  } catch {
    return undefined;
  }
  for (const chunk of chunks) {
    if (chunk.type !== "iTXt") {
      continue;
    }
    try {
      const fields = decodeITxt(chunk);
      if (fields.keyword === KEYWORD) {
        if (!fields.compressed) {
          throw new ProjectFileError("broken");
        }
        return new Uint8Array(fields.text);
      }
    } catch (error) {
      if (error instanceof ProjectFileError) {
        throw error;
      }
    }
  }
  return undefined;
}

/**
 * The recipe embedded in a PNG file, validated like any untrusted recipe. Rejects only
 * with ProjectFileError; kind `none` means the file holds no project at all.
 */
export async function readProject(bytes: Uint8Array): Promise<Recipe> {
  const text = projectText(bytes);
  if (text === undefined) {
    throw new ProjectFileError("none");
  }
  let project: unknown;
  try {
    const json = await decompress(text, "deflate", MAX_TEXT_BYTES);
    project = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(json));
  } catch {
    throw new ProjectFileError("broken");
  }
  if (!isFields(project) || typeof project.format !== "number") {
    throw new ProjectFileError("broken");
  }
  if (project.format !== FILE_FORMAT) {
    throw new ProjectFileError(project.format > FILE_FORMAT ? "newer" : "broken");
  }
  const recipe = project.recipe;
  if (!isFields(recipe) || Object.hasOwn(recipe, "assets")) {
    throw new ProjectFileError("invalid");
  }
  unpackStrokes(recipe);
  // Validating the recipe first means a bad one costs nothing to inflate, and only the
  // assets it uses are inflated.
  let parsed: Recipe;
  try {
    parsed = parseRecipe(migrateRecipe(recipe));
  } catch {
    throw new ProjectFileError("invalid");
  }
  const assets = await decodeAssets(project.assets, new Set(referencedAssets(parsed)));
  try {
    return parseRecipe({ ...parsed, assets });
  } catch {
    throw new ProjectFileError("invalid");
  }
}
