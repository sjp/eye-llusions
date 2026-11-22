import { PngError, type PngChunk } from "./chunks.ts";

/**
 * An iTXt chunk's fields. `text` is the UTF-8 text as stored: zlib-compressed when
 * `compressed` is set, so compression stays with the caller.
 */
type InternationalText = {
  keyword: string;
  compressed: boolean;
  language?: string;
  translatedKeyword?: string;
  text: Uint8Array;
};

function latin1(text: string): Uint8Array {
  if (!/^[ -~¡-ÿ]*$/.test(text)) {
    throw new PngError("iTXt keyword must be printable Latin-1");
  }
  return Uint8Array.from(text, (char) => char.codePointAt(0) ?? 0);
}

function nullAt(bytes: Uint8Array, from: number): number {
  const index = bytes.indexOf(0, from);
  if (index === -1) {
    throw new PngError("iTXt field isn't terminated");
  }
  return index;
}

export function encodeITxt({
  keyword,
  compressed,
  language = "",
  translatedKeyword = "",
  text,
}: InternationalText): PngChunk {
  if (keyword.length < 1 || keyword.length > 79 || keyword.trim() !== keyword) {
    throw new PngError("iTXt keyword must be 1 to 79 characters without outer spaces");
  }
  const encoder = new TextEncoder();
  const parts = [
    latin1(keyword),
    Uint8Array.of(0, compressed ? 1 : 0, 0),
    latin1(language),
    Uint8Array.of(0),
    encoder.encode(translatedKeyword),
    Uint8Array.of(0),
    text,
  ];
  const data = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    data.set(part, offset);
    offset += part.length;
  }
  return { type: "iTXt", data };
}

/** Reads an iTXt chunk's fields; `text` is a view into the chunk data. */
export function decodeITxt(chunk: PngChunk): InternationalText {
  const { data } = chunk;
  if (chunk.type !== "iTXt") {
    throw new PngError("not an iTXt chunk");
  }
  const keywordEnd = nullAt(data, 0);
  if (keywordEnd + 2 >= data.length) {
    throw new PngError("iTXt chunk is truncated");
  }
  const flag = data[keywordEnd + 1];
  const method = data[keywordEnd + 2];
  if (flag > 1 || method !== 0) {
    throw new PngError("unknown iTXt compression");
  }
  const languageEnd = nullAt(data, keywordEnd + 3);
  const translatedEnd = nullAt(data, languageEnd + 1);
  const latin1Text = (bytes: Uint8Array): string => String.fromCodePoint(...bytes);
  return {
    keyword: latin1Text(data.subarray(0, keywordEnd)),
    compressed: flag === 1,
    language: latin1Text(data.subarray(keywordEnd + 3, languageEnd)),
    translatedKeyword: new TextDecoder().decode(data.subarray(languageEnd + 1, translatedEnd)),
    text: data.subarray(translatedEnd + 1),
  };
}
