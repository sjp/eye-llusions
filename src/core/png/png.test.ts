import { describe, expect, test } from "vitest";
import { hasPngSignature, insertChunk, PngError, readChunks, writeChunks } from "./chunks.ts";
import { crc32 } from "./crc32.ts";
import { decodeITxt, encodeITxt } from "./itxt.ts";

const ascii = (text: string) => new TextEncoder().encode(text);

/** zlib-compressed scanline: filter 0, then a red and a blue pixel. */
const ZLIB_SCANLINE = Uint8Array.of(120, 156, 99, 248, 207, 0, 4, 255, 1, 7, 0, 1, 255);

/** As zlib computes it over the type and data. */
const IHDR_CRC = 0x7b40e8dd;

/** A 2 × 1 RGB image: one red and one blue pixel. */
function tinyPng(): Uint8Array<ArrayBuffer> {
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, 2);
  view.setUint32(4, 1);
  header.set([8, 2, 0, 0, 0], 8);
  return writeChunks([
    { type: "IHDR", data: header },
    { type: "IDAT", data: ZLIB_SCANLINE },
    { type: "IEND", data: new Uint8Array() },
  ]);
}

describe("crc32", () => {
  test("matches the standard check value and zlib's output", () => {
    expect(crc32(ascii("123456789"))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array())).toBe(0);
    const bytes = Uint8Array.from({ length: 5000 }, (_, i) => (i * 7919) & 0xff);
    expect(crc32(bytes)).toBe(0xa3d9e20a);
  });

  test("continues across pieces", () => {
    const bytes = ascii("Eye-llusion recipe");
    expect(crc32(bytes.subarray(7), crc32(bytes.subarray(0, 7)))).toBe(crc32(bytes));
  });
});

describe("PNG chunks", () => {
  test("writes the signature, lengths and the CRCs over type and data", () => {
    const png = tinyPng();
    expect(hasPngSignature(png)).toBe(true);
    const view = new DataView(png.buffer);
    expect(view.getUint32(8)).toBe(13);
    expect(String.fromCodePoint(...png.subarray(12, 16))).toBe("IHDR");
    expect(view.getUint32(29)).toBe(IHDR_CRC);
    // IEND's CRC is a well-known constant.
    expect([...png.subarray(-8)]).toEqual([0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]);
  });

  test("reads back what it wrote", () => {
    const chunks = readChunks(tinyPng());
    expect(chunks.map((chunk) => chunk.type)).toEqual(["IHDR", "IDAT", "IEND"]);
    expect(chunks[0].data.length).toBe(13);
    expect(writeChunks(chunks)).toEqual(tinyPng());
  });

  test("inserts a chunk after IHDR and keeps every CRC valid", () => {
    const png = tinyPng();
    const text = encodeITxt({ keyword: "Comment", compressed: false, text: ascii("hi") });
    const out = insertChunk(png, text);
    const chunks = readChunks(out);
    expect(chunks.map((chunk) => chunk.type)).toEqual(["IHDR", "iTXt", "IDAT", "IEND"]);
    expect(chunks[1].data).toEqual(text.data);
    expect(out.length).toBe(png.length + 12 + text.data.length);
    // The original chunks are byte for byte the same.
    expect(out.subarray(0, 33)).toEqual(png.subarray(0, 33));
    expect(out.subarray(33 + 12 + text.data.length)).toEqual(png.subarray(33));
  });

  test("ignores bytes after IEND", () => {
    const png = tinyPng();
    const padded = new Uint8Array(png.length + 4);
    padded.set(png);
    expect(readChunks(padded).map((chunk) => chunk.type)).toEqual(["IHDR", "IDAT", "IEND"]);
  });

  test.each([
    ["a wrong signature", (png: Uint8Array) => png.with(1, 0x51)],
    ["a damaged chunk", (png: Uint8Array) => png.with(40, png[40] ^ 1)],
    ["a damaged CRC", (png: Uint8Array) => png.with(png.length - 1, 0)],
    ["a missing IEND", (png: Uint8Array) => png.subarray(0, png.length - 12)],
    ["a cut-off chunk", (png: Uint8Array) => png.subarray(0, 40)],
    ["an oversized length", (png: Uint8Array) => png.with(8, 0x7f)],
    ["IHDR not first", (png: Uint8Array) => writeChunks(readChunks(png).slice(1))],
    ["a bad chunk type", (png: Uint8Array) => png.with(12, 0x31)],
  ])("rejects %s", (_name, damage) => {
    expect(() => readChunks(damage(tinyPng()))).toThrow(PngError);
  });

  test("refuses invalid chunk types when writing", () => {
    expect(() => writeChunks([{ type: "iT1t", data: new Uint8Array() }])).toThrow(PngError);
  });
});

describe("iTXt", () => {
  test("lays out the fields as the PNG specification does", () => {
    const chunk = encodeITxt({
      keyword: "Title",
      compressed: true,
      language: "fr",
      translatedKeyword: "Titre",
      text: Uint8Array.of(1, 2),
    });
    expect(chunk.type).toBe("iTXt");
    expect([...chunk.data]).toEqual([
      ...ascii("Title"),
      0,
      1,
      0,
      ...ascii("fr"),
      0,
      ...ascii("Titre"),
      0,
      1,
      2,
    ]);
  });

  test("round-trips every field", () => {
    const fields = {
      keyword: "eye-llusion-recipe",
      compressed: false,
      language: "en-GB",
      translatedKeyword: "Rezept für Bilder",
      text: ascii('{"a":"ü"}'),
    };
    expect(decodeITxt(encodeITxt(fields))).toEqual(fields);
    expect(decodeITxt(encodeITxt({ ...fields, text: new Uint8Array() })).text.length).toBe(0);
  });

  test.each([
    ["an empty keyword", ""],
    ["a long keyword", "k".repeat(80)],
    ["outer spaces", " key"],
    ["a non-Latin-1 keyword", "ключ"],
  ])("refuses %s", (_name, keyword) => {
    expect(() => encodeITxt({ keyword, compressed: false, text: new Uint8Array() })).toThrow(
      PngError,
    );
  });

  test.each([
    ["an unterminated keyword", Uint8Array.of(0x41, 0x42)],
    ["missing flags", Uint8Array.of(0x41, 0)],
    ["an unknown method", Uint8Array.of(0x41, 0, 1, 1, 0, 0)],
    ["an unknown flag", Uint8Array.of(0x41, 0, 2, 0, 0, 0)],
    ["an unterminated language", Uint8Array.of(0x41, 0, 0, 0, 0x65)],
  ])("rejects %s", (_name, data) => {
    expect(() => decodeITxt({ type: "iTXt", data })).toThrow(PngError);
  });

  test("rejects other chunk types", () => {
    expect(() => decodeITxt({ type: "tEXt", data: Uint8Array.of(0x41, 0, 0, 0, 0, 0) })).toThrow(
      PngError,
    );
  });
});
