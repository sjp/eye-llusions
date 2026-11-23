import { referencedAssets } from "../core/assets.ts";
import { readChunks, writeChunks, type PngChunk } from "../core/png/chunks.ts";
import { decodeITxt, encodeITxt } from "../core/png/itxt.ts";
import { migrateRecipe } from "../core/migrateRecipe.ts";
import { isNewerRecipe, parseRecipe, RECIPE_LIMITS } from "../core/parseRecipe.ts";
import type { Asset, Recipe } from "../core/recipe.ts";
import { compress, decompress, fromBase64Url } from "./bytes.ts";
import { packRecipe, unpackStrokes } from "./share.ts";

const KEYWORD = "eye-llusion-recipe";
/**
 * A private, ancillary, safe-to-copy chunk holding one asset: its ID in ASCII, a zero
 * byte, then its filtered pixels deflated.
 */
const ASSET_CHUNK = "eyAs";
/** Bumped whenever the embedded project changes in a way old readers can't open. */
const FILE_FORMAT = 2;
/** The first format that keeps assets in chunks of their own rather than in the text. */
const ASSET_CHUNKS_FORMAT = 2;
/**
 * Cap on the embedded text once inflated. Earlier formats held the assets in base64
 * there, so it allows for the asset limit as well as the recipe.
 */
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

type AssetInfo = Pick<Asset, "format" | "width" | "height">;

const channels = (format: Asset["format"]): number => (format === "gray" ? 1 : 4);

/**
 * PNG's Sub filter: each byte becomes its difference from the same channel of the
 * pixel to its left, which deflate compresses much better for photos and gradients.
 */
function subFilter(data: Uint8Array, rowBytes: number, step: number): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(data.length);
  for (let row = 0; row < data.length; row += rowBytes) {
    const end = row + rowBytes;
    out.set(data.subarray(row, row + step), row);
    for (let i = row + step; i < end; i++) {
      out[i] = data[i] - data[i - step];
    }
  }
  return out;
}

function unSubFilter(data: Uint8Array<ArrayBuffer>, rowBytes: number, step: number): void {
  for (let row = 0; row < data.length; row += rowBytes) {
    const end = row + rowBytes;
    for (let i = row + step; i < end; i++) {
      data[i] += data[i - step];
    }
  }
}

/** Deflates the asset's pixels after the Sub filter. */
function packPixels({ format, width, data }: Asset): Promise<Uint8Array<ArrayBuffer>> {
  const step = channels(format);
  return compress(subFilter(data, width * step, step), "deflate-raw");
}

async function assetChunk(id: string, asset: Asset): Promise<PngChunk> {
  const packed = await packPixels(asset);
  const data = new Uint8Array(id.length + 1 + packed.length);
  for (let i = 0; i < id.length; i++) {
    data[i] = id.codePointAt(i) ?? 0;
  }
  data.set(packed, id.length + 1);
  return { type: ASSET_CHUNK, data };
}

/**
 * The PNG file with the recipe embedded in an iTXt chunk after IHDR, and each asset in
 * a chunk of its own before IEND. Assets are filtered and deflated byte arrays, so a
 * grey image costs one byte per pixel at most.
 */
export async function embedProject(
  png: Uint8Array,
  recipe: Recipe,
): Promise<Uint8Array<ArrayBuffer>> {
  const entries = Object.entries(recipe.assets);
  const assets: Record<string, AssetInfo> = {};
  for (const [id, { format, width, height }] of entries) {
    assets[id] = { format, width, height };
  }
  const project = { format: FILE_FORMAT, recipe: packRecipe(recipe), assets };
  const [text, packed] = await Promise.all([
    compress(new TextEncoder().encode(JSON.stringify(project)), "deflate"),
    Promise.all(entries.map(([id, asset]) => assetChunk(id, asset))),
  ]);
  const chunks = readChunks(png);
  const end = chunks.length - 1;
  return writeChunks([
    chunks[0],
    encodeITxt({ keyword: KEYWORD, compressed: true, text }),
    ...chunks.slice(1, end),
    ...packed,
    chunks[end],
  ]);
}

function isFields(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function side(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 1 && Number(value) <= RECIPE_LIMITS.assetSide;
}

/**
 * Where an asset's deflated pixels are: base64 text in the project's own `data` field in
 * the first format, a chunk of their own since.
 */
type PackedData = (id: string, fields: Record<string, unknown>) => Uint8Array<ArrayBuffer>;

/** Inflates the assets with IDs in `wanted`, checking their sizes first. */
async function decodeAssets(
  input: unknown,
  wanted: ReadonlySet<string>,
  packedData: PackedData,
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
      !side(value.height)
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
    const packed = packedData(id, value);
    let data: Uint8Array<ArrayBuffer>;
    try {
      data = await decompress(packed, "deflate-raw", size);
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

/** Version 1 projects hold each asset's pixels as base64url in its `data` field. */
const inlineData: PackedData = (_, fields) => {
  if (typeof fields.data !== "string") {
    throw new ProjectFileError("invalid");
  }
  try {
    return fromBase64Url(fields.data);
  } catch {
    throw new ProjectFileError("broken");
  }
};

/** The project's compressed text and its asset chunks' data, by asset ID. */
type Embedded = { text: Uint8Array<ArrayBuffer>; assets: Map<string, Uint8Array> };

function embedded(bytes: Uint8Array): Embedded | undefined {
  let chunks;
  try {
    chunks = readChunks(bytes);
  } catch {
    return undefined;
  }
  let text: Uint8Array<ArrayBuffer> | undefined;
  const assets = new Map<string, Uint8Array>();
  for (const chunk of chunks) {
    if (chunk.type === ASSET_CHUNK) {
      const end = chunk.data.indexOf(0);
      const id = end < 1 ? "" : String.fromCodePoint(...chunk.data.subarray(0, end));
      if (id === "" || assets.has(id)) {
        throw new ProjectFileError("broken");
      }
      assets.set(id, chunk.data.subarray(end + 1));
    }
    if (chunk.type !== "iTXt" || text !== undefined) {
      continue;
    }
    try {
      const fields = decodeITxt(chunk);
      if (fields.keyword === KEYWORD) {
        if (!fields.compressed) {
          throw new ProjectFileError("broken");
        }
        text = new Uint8Array(fields.text);
      }
    } catch (error) {
      if (error instanceof ProjectFileError) {
        throw error;
      }
    }
  }
  return text === undefined ? undefined : { text, assets };
}

/**
 * The recipe embedded in a PNG file, validated like any untrusted recipe. Rejects only
 * with ProjectFileError; kind `none` means the file holds no project at all.
 */
export async function readProject(bytes: Uint8Array): Promise<Recipe> {
  const found = embedded(bytes);
  if (found === undefined) {
    throw new ProjectFileError("none");
  }
  let project: unknown;
  try {
    const json = await decompress(found.text, "deflate", MAX_TEXT_BYTES);
    project = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(json));
  } catch {
    throw new ProjectFileError("broken");
  }
  if (!isFields(project) || typeof project.format !== "number") {
    throw new ProjectFileError("broken");
  }
  if (project.format > FILE_FORMAT) {
    throw new ProjectFileError("newer");
  }
  if (project.format !== 1 && project.format !== ASSET_CHUNKS_FORMAT) {
    throw new ProjectFileError("broken");
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
  } catch (error) {
    throw new ProjectFileError(isNewerRecipe(error, recipe) ? "newer" : "invalid");
  }
  const chunkData: PackedData = (id) => {
    const data = found.assets.get(id);
    if (data === undefined) {
      throw new ProjectFileError("broken");
    }
    return new Uint8Array(data);
  };
  const assets = await decodeAssets(
    project.assets,
    new Set(referencedAssets(parsed)),
    project.format === 1 ? inlineData : chunkData,
  );
  try {
    return parseRecipe({ ...parsed, assets });
  } catch {
    throw new ProjectFileError("invalid");
  }
}
