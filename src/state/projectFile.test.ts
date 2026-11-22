import { describe, expect, test } from "vitest";
import { insertChunk, readChunks, writeChunks } from "../core/png/chunks.ts";
import { decodeITxt, encodeITxt } from "../core/png/itxt.ts";
import { createRandom } from "../core/random.ts";
import { defaultRecipe, type Asset, type DrawingLayer, type Recipe } from "../core/recipe.ts";
import { compress } from "./bytes.ts";
import { embedProject, ProjectFileError, readProject } from "./projectFile.ts";

/** A 2 × 1 RGB image, zlib data and all. */
function tinyPng(): Uint8Array<ArrayBuffer> {
  const header = Uint8Array.of(0, 0, 0, 2, 0, 0, 0, 1, 8, 2, 0, 0, 0);
  return writeChunks([
    { type: "IHDR", data: header },
    {
      type: "IDAT",
      data: Uint8Array.of(120, 156, 99, 248, 207, 0, 4, 255, 1, 7, 0, 1, 255),
    },
    { type: "IEND", data: new Uint8Array() },
  ]);
}

function grey(width: number, height: number): Asset {
  const random = createRandom(3);
  const data = new Uint8Array(width * height);
  for (let i = 0; i < data.length; i++) {
    // A gradient with a little noise, like a photo.
    data[i] = ((i % width) + (random.uint32() & 7)) & 0xff;
  }
  return { format: "gray", width, height, data };
}

function colour(width: number, height: number): Asset {
  const random = createRandom(4);
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < data.length; i++) {
    data[i] = i % 4 === 3 ? 255 : random.uint32() & 0xff;
  }
  return { format: "rgba", width, height, data };
}

function project(): Recipe {
  const brush = { size: 0.05, softness: 0.5, mode: "raise" as const, value: 0.4 };
  const drawing: DrawingLayer = {
    kind: "drawing",
    id: "drawing-1",
    name: "Drawing",
    visible: true,
    blend: "add",
    depth: 1,
    strokes: [{ brush, points: [0.25, 0.5, 0.5, 0.25, 1 / 3, 0.123_456_7] }],
  };
  return {
    ...defaultRecipe(),
    layers: [
      ...defaultRecipe().layers,
      drawing,
      {
        kind: "image",
        id: "image-1",
        name: "Photo ✨",
        visible: true,
        blend: "max",
        depth: 0.7,
        asset: "image-1",
        fit: "cover",
        invert: true,
        levels: { black: 0.1, white: 0.9 },
        blur: 0.01,
        posterize: 5,
        threshold: null,
      },
    ],
    texture: {
      ...defaultRecipe().texture,
      generator: { type: "tile", asset: "tile-1", divisions: 2, jitter: 0.25 },
    },
    assets: { "image-1": grey(300, 200), "tile-1": colour(64, 48) },
  };
}

/** A PNG holding `text` (compressed for it) under the project keyword. */
async function withText(text: string, compressed = true): Promise<Uint8Array> {
  const bytes = new TextEncoder().encode(text);
  return insertChunk(
    tinyPng(),
    encodeITxt({
      keyword: "eye-llusion-recipe",
      compressed,
      text: compressed ? await compress(bytes, "deflate") : bytes,
    }),
  );
}

async function problem(bytes: Uint8Array): Promise<string> {
  const error: unknown = await readProject(bytes).then(
    () => undefined,
    (reason: unknown) => reason,
  );
  if (!(error instanceof ProjectFileError)) {
    throw new TypeError(`expected a ProjectFileError, got ${String(error)}`);
  }
  return error.kind;
}

/** The embedded project as plain JSON, for tampering with. */
async function embeddedJson(recipe: Recipe): Promise<Record<string, unknown>> {
  const png = await embedProject(tinyPng(), recipe);
  const chunk = readChunks(png).find((each) => each.type === "iTXt");
  if (chunk === undefined) {
    throw new Error("no iTXt chunk");
  }
  const stream = new Blob([new Uint8Array(decodeITxt(chunk).text)])
    .stream()
    .pipeThrough(new DecompressionStream("deflate"));
  const parsed: unknown = JSON.parse(await new Response(stream).text());
  if (typeof parsed !== "object" || parsed === null) {
    throw new TypeError("not an object");
  }
  return { ...parsed };
}

describe("PNG project files", () => {
  test("round-trips a recipe with grey and colour assets through bytes", async () => {
    const recipe = project();
    const png = await embedProject(tinyPng(), recipe);
    expect(await readProject(png)).toEqual(recipe);
  });

  test("adds one compressed iTXt chunk after IHDR and leaves the image alone", async () => {
    const png = await embedProject(tinyPng(), project());
    const chunks = readChunks(png);
    expect(chunks.map((chunk) => chunk.type)).toEqual(["IHDR", "iTXt", "IDAT", "IEND"]);
    const text = decodeITxt(chunks[1]);
    expect(text).toMatchObject({ keyword: "eye-llusion-recipe", compressed: true });
    expect(chunks[2].data).toEqual(readChunks(tinyPng())[1].data);
  });

  test("stores assets compactly", async () => {
    const recipe = project();
    const png = await embedProject(tinyPng(), recipe);
    const raw = recipe.assets["image-1"].data.length + recipe.assets["tile-1"].data.length;
    // Random colour noise can't shrink, but alpha and the grey gradient do.
    expect(png.length).toBeLessThan(raw * 0.85);
  });

  test("round-trips a recipe without assets", async () => {
    const recipe = defaultRecipe();
    expect(await readProject(await embedProject(tinyPng(), recipe))).toEqual(recipe);
  });

  test("finds no project in a plain PNG or another kind of file", async () => {
    expect(await problem(tinyPng())).toBe("none");
    expect(await problem(Uint8Array.of(0xff, 0xd8, 0xff, 0xe0))).toBe("none");
    expect(await problem(new Uint8Array())).toBe("none");
    const other = insertChunk(
      tinyPng(),
      encodeITxt({ keyword: "Comment", compressed: false, text: Uint8Array.of(0x41) }),
    );
    expect(await problem(other)).toBe("none");
  });

  test("reports damaged project data", async () => {
    expect(await problem(await withText("{not json"))).toBe("broken");
    expect(await problem(await withText("{}", false))).toBe("broken");
    expect(await problem(await withText("[1]"))).toBe("broken");
    const corrupt = insertChunk(
      tinyPng(),
      encodeITxt({ keyword: "eye-llusion-recipe", compressed: true, text: Uint8Array.of(1, 2) }),
    );
    expect(await problem(corrupt)).toBe("broken");
  });

  test("reports projects from a newer version", async () => {
    expect(await problem(await withText('{"format":2}'))).toBe("newer");
  });

  test("rejects recipes that don't validate", async () => {
    const json = await embeddedJson(defaultRecipe());
    const bad = { ...json, recipe: { ...defaultRecipe(), assets: undefined, layers: "x" } };
    expect(await problem(await withText(JSON.stringify(bad)))).toBe("invalid");
    expect(await problem(await withText(JSON.stringify({ ...json, assets: [] })))).toBe("invalid");
  });

  test("checks asset sizes before inflating them", async () => {
    const json = await embeddedJson(project());
    const assets: unknown = json.assets;
    if (typeof assets !== "object" || assets === null) {
      throw new TypeError("no assets");
    }
    const image: unknown = Object.entries(assets).find(([id]) => id === "image-1")?.[1];
    if (typeof image !== "object" || image === null) {
      throw new TypeError("no image asset");
    }
    const tamper = async (patch: Record<string, unknown>) =>
      problem(
        await withText(
          JSON.stringify({ ...json, assets: { ...assets, "image-1": { ...image, ...patch } } }),
        ),
      );
    expect(await tamper({ width: 4096 })).toBe("invalid");
    expect(await tamper({ width: 0 })).toBe("invalid");
    expect(await tamper({ format: "rgb" })).toBe("invalid");
    expect(await tamper({ data: 5 })).toBe("invalid");
    // The data inflates to more or fewer bytes than the size says.
    expect(await tamper({ width: 299 })).toBe("broken");
    expect(await tamper({ width: 301 })).toBe("broken");
    expect(await tamper({ data: "@@" })).toBe("broken");
    const many = Object.fromEntries(
      Array.from({ length: 17 }, (_, i) => [`image-${String(i)}`, image]),
    );
    expect(await problem(await withText(JSON.stringify({ ...json, assets: many })))).toBe(
      "invalid",
    );
  });
});
