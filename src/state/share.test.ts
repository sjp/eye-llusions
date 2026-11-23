import { describe, expect, test } from "vitest";
import { defaultRecipe, type DrawingLayer, type Recipe, type TextLayer } from "../core/recipe.ts";
import { finishStroke } from "../core/strokes.ts";
import { decodeRecipe, encodeRecipe, linkPayload, shareUrl, ShareLinkError } from "./share.ts";

function textRecipe(): Recipe {
  const text: TextLayer = {
    kind: "text",
    id: "text-1",
    name: "Text",
    visible: true,
    blend: "max",
    depth: 0.8,
    text: "HELLO\nWÖRLD ✨",
    font: "anton",
    size: 0.3,
    center: { x: 0.5, y: 0.5 },
    edge: "round",
    edgeWidth: 0.02,
  };
  return { ...defaultRecipe(), layers: [...defaultRecipe().layers, text] };
}

function drawingRecipe(): Recipe {
  const brush = { size: 0.05, softness: 0.5, mode: "raise" as const, value: 0.4 };
  const wiggle = Array.from({ length: 400 }, (_, i) => [i / 400, 0.5 + Math.sin(i / 9) / 4]).flat();
  const drawing: DrawingLayer = {
    kind: "drawing",
    id: "drawing-1",
    name: "Drawing",
    visible: true,
    blend: "add",
    depth: 1,
    strokes: [
      { brush, points: finishStroke(wiggle, 16 / 9, brush.size) },
      { brush, points: [-0.5, 1.5, 0.3, 0.7] },
      // Off the drawing grid, as an imported recipe might be.
      { brush, points: [0.1, 0.2, 1 / 3, 0.123_456_7] },
    ],
  };
  return { ...defaultRecipe(), layers: [drawing] };
}

async function compress(text: string): Promise<string> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("deflate-raw"));
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  return btoa(String.fromCodePoint(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

describe("share links", () => {
  test("round-trip a recipe exactly", async () => {
    for (const recipe of [defaultRecipe(), textRecipe(), drawingRecipe()]) {
      const payload = await encodeRecipe(recipe);
      expect(payload).toMatch(/^1\.[\w-]+$/);
      expect(await decodeRecipe(payload)).toEqual(recipe);
    }
  });

  test("leave assets out", async () => {
    const recipe: Recipe = {
      ...defaultRecipe(),
      assets: {
        a: { format: "gray", width: 1, height: 1, data: new Uint8Array([7]) },
      },
    };
    const decoded = await decodeRecipe(await encodeRecipe(recipe));
    expect(decoded.assets).toEqual({});
    expect({ ...decoded, assets: recipe.assets }).toEqual(recipe);
  });

  test("reject truncated, tampered and foreign payloads with a ShareLinkError", async () => {
    const payload = await encodeRecipe(textRecipe());
    const tampered = [
      "",
      "1",
      "1.",
      ".abc",
      "x.abc",
      "1.!!!!",
      "1.a",
      payload.slice(0, -10),
      payload.slice(0, payload.length / 2),
      `${payload.slice(0, 20)}AAAA${payload.slice(24)}`,
      `1.${await compress("not json")}`,
      `1.${await compress('{"version":1}')}`,
      `1.${await compress("[]")}`,
      `1.${await compress("null")}`,
      `1.${await compress(JSON.stringify({ ...defaultRecipe(), layers: [{ ...drawingRecipe().layers[0], strokes: [{ brush: {}, steps: [1, "x"] }] }] }))}`,
    ];
    for (const bad of tampered) {
      await expect(decodeRecipe(bad)).rejects.toBeInstanceOf(ShareLinkError);
    }
  });

  test("say when a link comes from a newer version", async () => {
    const payload = await encodeRecipe(defaultRecipe());
    await expect(decodeRecipe(`2${payload.slice(1)}`)).rejects.toThrow(/newer version/);
  });

  test("say when a link holds a recipe from a newer version", async () => {
    const newer = { ...defaultRecipe(), assets: undefined, version: 2, newField: true };
    await expect(decodeRecipe(`1.${await compress(JSON.stringify(newer))}`)).rejects.toThrow(
      /newer version/,
    );
    const older = { ...defaultRecipe(), assets: undefined, version: 0 };
    await expect(decodeRecipe(`1.${await compress(JSON.stringify(older))}`)).rejects.toThrow(
      /can show/,
    );
  });

  test("refuse payloads that inflate past the size cap", async () => {
    const bomb = await compress(`"${"a".repeat(20 * 1024 * 1024)}"`);
    await expect(decodeRecipe(`1.${bomb}`)).rejects.toBeInstanceOf(ShareLinkError);
  });

  test("read and write the #r= fragment", async () => {
    const payload = await encodeRecipe(defaultRecipe());
    const url = shareUrl("https://example.com/app/?q=1#old", payload);
    expect(url).toBe(`https://example.com/app/?q=1#r=${payload}`);
    expect(linkPayload(new URL(url).hash)).toBe(payload);
    expect(linkPayload("#other")).toBeUndefined();
    expect(linkPayload("")).toBeUndefined();
  });

  test.each([".", ")", "),", "...", "&utm_source=chat", "?ref=x", "%29", " see you"])(
    "ignore %j that chat apps add after a link",
    async (junk) => {
      const recipe = defaultRecipe();
      const payload = await encodeRecipe(recipe);
      const hash = new URL(`${shareUrl("https://example.com/", payload)}${junk}`).hash;
      expect(linkPayload(hash)).toBe(payload);
      expect(await decodeRecipe(linkPayload(hash) ?? "")).toEqual(recipe);
    },
  );
});
