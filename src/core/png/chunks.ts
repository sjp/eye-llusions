import { crc32 } from "./crc32.ts";

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const MAX_CHUNK_LENGTH = 0x7fff_ffff;

/** A PNG chunk: a four-letter type and its data, without length or CRC. */
export type PngChunk = { type: string; data: Uint8Array };

/** The bytes aren't a well-formed PNG file. */
export class PngError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PngError";
  }
}

export function hasPngSignature(bytes: Uint8Array): boolean {
  return bytes.length >= SIGNATURE.length && SIGNATURE.every((byte, i) => bytes[i] === byte);
}

function typeBytes(type: string): Uint8Array {
  if (!/^[A-Za-z]{4}$/.test(type)) {
    throw new PngError(`invalid chunk type ${JSON.stringify(type)}`);
  }
  return Uint8Array.from(type, (char) => char.codePointAt(0) ?? 0);
}

/**
 * Splits a PNG file into its chunks, checking the signature, every length and CRC, that
 * IHDR comes first and that the file ends with IEND. Chunk data are views into `bytes`.
 */
export function readChunks(bytes: Uint8Array): PngChunk[] {
  if (!hasPngSignature(bytes)) {
    throw new PngError("not a PNG file");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const chunks: PngChunk[] = [];
  let offset = SIGNATURE.length;
  for (;;) {
    if (offset + 12 > bytes.length) {
      throw new PngError("file ends before IEND");
    }
    const length = view.getUint32(offset);
    if (length > MAX_CHUNK_LENGTH || offset + 12 + length > bytes.length) {
      throw new PngError("chunk runs past the end of the file");
    }
    const typed = bytes.subarray(offset + 4, offset + 8 + length);
    const type = String.fromCodePoint(...typed.subarray(0, 4));
    if (!/^[A-Za-z]{4}$/.test(type)) {
      throw new PngError("invalid chunk type");
    }
    if (crc32(typed) !== view.getUint32(offset + 8 + length)) {
      throw new PngError(`bad CRC in ${type} chunk`);
    }
    if (chunks.length === 0 && type !== "IHDR") {
      throw new PngError("IHDR isn't the first chunk");
    }
    chunks.push({ type, data: typed.subarray(4) });
    offset += 12 + length;
    if (type === "IEND") {
      return chunks;
    }
  }
}

/** A PNG file made of `chunks`, with lengths and CRCs filled in. */
export function writeChunks(chunks: readonly PngChunk[]): Uint8Array<ArrayBuffer> {
  let size = SIGNATURE.length;
  for (const chunk of chunks) {
    if (chunk.data.length > MAX_CHUNK_LENGTH) {
      throw new PngError(`${chunk.type} chunk is too long`);
    }
    size += 12 + chunk.data.length;
  }
  const out = new Uint8Array(size);
  const view = new DataView(out.buffer);
  out.set(SIGNATURE);
  let offset = SIGNATURE.length;
  for (const chunk of chunks) {
    view.setUint32(offset, chunk.data.length);
    out.set(typeBytes(chunk.type), offset + 4);
    out.set(chunk.data, offset + 8);
    view.setUint32(
      offset + 8 + chunk.data.length,
      crc32(out.subarray(offset + 4, offset + 8 + chunk.data.length)),
    );
    offset += 12 + chunk.data.length;
  }
  return out;
}

/** The PNG file with `chunk` added straight after IHDR. */
export function insertChunk(png: Uint8Array, chunk: PngChunk): Uint8Array<ArrayBuffer> {
  const chunks = readChunks(png);
  return writeChunks([chunks[0], chunk, ...chunks.slice(1)]);
}
