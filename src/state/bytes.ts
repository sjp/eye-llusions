function streamOf(bytes: Uint8Array<ArrayBuffer>): ReadableStream<Uint8Array<ArrayBuffer>> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

/** Reads a whole stream, throwing RangeError once it passes `limit` bytes. */
async function collect(
  stream: ReadableStream<Uint8Array<ArrayBuffer>>,
  limit = Infinity,
): Promise<Uint8Array<ArrayBuffer>> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    total += value.length;
    if (total > limit) {
      await reader.cancel();
      throw new RangeError("Data is larger than expected");
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

export function compress(
  bytes: Uint8Array<ArrayBuffer>,
  format: CompressionFormat,
): Promise<Uint8Array<ArrayBuffer>> {
  return collect(streamOf(bytes).pipeThrough(new CompressionStream(format)));
}

/** Rejects on corrupt data, and with RangeError once the output passes `limit` bytes. */
export function decompress(
  bytes: Uint8Array<ArrayBuffer>,
  format: CompressionFormat,
  limit = Infinity,
): Promise<Uint8Array<ArrayBuffer>> {
  return collect(streamOf(bytes).pipeThrough(new DecompressionStream(format)), limit);
}

type Base64Options = { alphabet: "base64url"; omitPadding?: boolean };

// The native base64 methods, which not every supported browser has yet.
declare global {
  interface Uint8Array {
    toBase64?: (options: Base64Options) => string;
  }
  interface Uint8ArrayConstructor {
    fromBase64?: (text: string, options: Base64Options) => Uint8Array<ArrayBuffer>;
  }
}

export function toBase64Url(bytes: Uint8Array): string {
  if (bytes.toBase64 !== undefined) {
    return bytes.toBase64({ alphabet: "base64url", omitPadding: true });
  }
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCodePoint(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

/** Throws SyntaxError on text that isn't unpadded base64url. */
export function fromBase64Url(text: string): Uint8Array<ArrayBuffer> {
  if (!/^[\w-]*$/.test(text) || text.length % 4 === 1) {
    throw new SyntaxError("Not base64url");
  }
  if (Uint8Array.fromBase64 !== undefined) {
    return Uint8Array.fromBase64(text, { alphabet: "base64url" });
  }
  const binary = atob(text.replaceAll("-", "+").replaceAll("_", "/"));
  return Uint8Array.from(binary, (char) => char.codePointAt(0) ?? 0);
}
