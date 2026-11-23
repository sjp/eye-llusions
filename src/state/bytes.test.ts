import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { compress, decompress, fromBase64Url, toBase64Url } from "./bytes.ts";

const toNative = Object.getOwnPropertyDescriptor(Uint8Array.prototype, "toBase64");
const fromNative = Object.getOwnPropertyDescriptor(Uint8Array, "fromBase64");

/** Hides the native base64 methods, so the fallback runs. */
function hideNative(): void {
  Reflect.deleteProperty(Uint8Array.prototype, "toBase64");
  Reflect.deleteProperty(Uint8Array, "fromBase64");
}

function restoreNative(): void {
  if (toNative !== undefined) {
    Reflect.defineProperty(Uint8Array.prototype, "toBase64", toNative);
  }
  if (fromNative !== undefined) {
    Reflect.defineProperty(Uint8Array, "fromBase64", fromNative);
  }
}

const EVERY_BYTE = Uint8Array.from({ length: 256 }, (_, i) => i);
const EVERY_BYTE_TEXT =
  "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8gISIjJCUmJygpKissLS4vMDEyMzQ1Njc4OTo7PD0-P0BBQkNERUZHSElKS0xNTk9QUVJTVFVWV1hZWltcXV5fYGFiY2RlZmdoaWprbG1ub3BxcnN0dXZ3eHl6e3x9fn-AgYKDhIWGh4iJiouMjY6PkJGSk5SVlpeYmZqbnJ2en6ChoqOkpaanqKmqq6ytrq-wsbKztLW2t7i5uru8vb6_wMHCw8TFxsfIycrLzM3Oz9DR0tPU1dbX2Nna29zd3t_g4eLj5OXm5-jp6uvs7e7v8PHy8_T19vf4-fr7_P3-_w";

describe.each([
  { name: "native", setUp: restoreNative },
  { name: "fallback", setUp: hideNative },
])("base64url ($name)", ({ setUp }) => {
  beforeEach(setUp);
  afterEach(restoreNative);

  test("encodes every byte value with the URL alphabet and no padding", () => {
    expect(toBase64Url(EVERY_BYTE)).toBe(EVERY_BYTE_TEXT);
    expect(toBase64Url(Uint8Array.of(0xfb, 0xff))).toBe("-_8");
    expect(toBase64Url(new Uint8Array())).toBe("");
  });

  test("decodes what it encodes, at every length up to a few groups", () => {
    for (let length = 0; length < 10; length++) {
      const bytes = EVERY_BYTE.subarray(250 - length * 20, 250 - length * 20 + length);
      expect(fromBase64Url(toBase64Url(bytes))).toEqual(bytes);
    }
    expect(fromBase64Url(EVERY_BYTE_TEXT)).toEqual(EVERY_BYTE);
  });

  test("handles data larger than the fallback's chunk size", () => {
    const bytes = Uint8Array.from({ length: 100_000 }, (_, i) => (i * 7919) & 0xff);
    expect(fromBase64Url(toBase64Url(bytes))).toEqual(bytes);
  });

  test.each(["A", "AAAAA", "AA==", "AA AA", "AA+/", "AA\nAA", "é"])(
    "rejects %j as not unpadded base64url",
    (text) => {
      expect(() => fromBase64Url(text)).toThrow(SyntaxError);
    },
  );
});

test("the fallback runs when the native methods are missing", () => {
  hideNative();
  try {
    expect("toBase64" in Uint8Array.prototype).toBe(false);
    expect(toBase64Url(Uint8Array.of(1, 2, 3))).toBe("AQID");
  } finally {
    restoreNative();
  }
});

describe.each(["deflate-raw", "gzip"] as const)("compression (%s)", (format) => {
  const text = new TextEncoder().encode("stereogram ".repeat(1000));

  test("decompresses what it compresses, empty input included", async () => {
    const packed = await compress(text, format);
    expect(packed.length).toBeLessThan(text.length / 10);
    expect(await decompress(packed, format)).toEqual(text);
    expect(await decompress(await compress(new Uint8Array(), format), format)).toEqual(
      new Uint8Array(),
    );
  });

  test("decompresses output of exactly the limit", async () => {
    const packed = await compress(text, format);
    expect(await decompress(packed, format, text.length)).toEqual(text);
  });

  test("stops reading and rejects with RangeError past the limit", async () => {
    const cancel = vi.spyOn(ReadableStreamDefaultReader.prototype, "cancel");
    try {
      const packed = await compress(text, format);
      await expect(decompress(packed, format, text.length - 1)).rejects.toThrow(RangeError);
      expect(cancel).toHaveBeenCalledOnce();
    } finally {
      cancel.mockRestore();
    }
  });

  test("rejects corrupt data, but not with RangeError", async () => {
    const packed = await compress(text, format);
    const damaged = packed.slice(0, packed.length >> 1);
    damaged[damaged.length - 1] ^= 0xff;
    const error: unknown = await decompress(damaged, format).catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(RangeError);
  });
});
