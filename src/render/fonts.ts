import { FONTS } from "../core/fonts.ts";

const LATIN =
  "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD";
const LATIN_EXT =
  "U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF";

type FontFile = { url: string; unicodeRange: string };

/** Literal `new URL` calls, so the bundler emits each file as a same-origin asset. */
const FILES: Partial<Record<string, readonly FontFile[]>> = {
  anton: [
    {
      url: new URL("../assets/fonts/anton/anton-latin.woff2", import.meta.url).href,
      unicodeRange: LATIN,
    },
    {
      url: new URL("../assets/fonts/anton/anton-latin-ext.woff2", import.meta.url).href,
      unicodeRange: LATIN_EXT,
    },
  ],
  "archivo-black": [
    {
      url: new URL("../assets/fonts/archivo-black/archivo-black-latin.woff2", import.meta.url).href,
      unicodeRange: LATIN,
    },
    {
      url: new URL("../assets/fonts/archivo-black/archivo-black-latin-ext.woff2", import.meta.url)
        .href,
      unicodeRange: LATIN_EXT,
    },
  ],
  "alfa-slab-one": [
    {
      url: new URL("../assets/fonts/alfa-slab-one/alfa-slab-one-latin.woff2", import.meta.url).href,
      unicodeRange: LATIN,
    },
    {
      url: new URL("../assets/fonts/alfa-slab-one/alfa-slab-one-latin-ext.woff2", import.meta.url)
        .href,
      unicodeRange: LATIN_EXT,
    },
  ],
};

function isFontSet(value: unknown): value is FontFaceSet {
  return typeof value === "object" && value !== null && "add" in value && "check" in value;
}

/** The global font set: `document.fonts` on a page, `self.fonts` in a worker. */
function fontSet(): FontFaceSet {
  const scope: object = globalThis;
  const fonts = "fonts" in scope ? scope.fonts : undefined;
  if (typeof FontFace !== "function" || !isFontSet(fonts)) {
    throw new Error("this browser can't load fonts for text layers");
  }
  return fonts;
}

async function fetchFont(file: FontFile): Promise<ArrayBuffer> {
  const response = await fetch(file.url);
  if (!response.ok) {
    throw new Error(`HTTP ${String(response.status)}`);
  }
  return response.arrayBuffer();
}

async function load(id: string, family: string): Promise<void> {
  const files = FILES[id];
  const label = FONTS.find((font) => font.id === id)?.label;
  if (files === undefined || label === undefined) {
    throw new Error(`there is no font called "${id}"`);
  }
  const fonts = fontSet();
  try {
    const faces = await Promise.all(
      files.map(async (file) => {
        const face = new FontFace(family, await fetchFont(file), {
          unicodeRange: file.unicodeRange,
        });
        return face.load();
      }),
    );
    for (const face of faces) {
      fonts.add(face);
    }
  } catch (error) {
    const reason = error instanceof Error ? `: ${error.message}` : "";
    throw new Error(`the font ${label} couldn't be loaded${reason}`, { cause: error });
  }
}

const loading = new Map<string, Promise<string>>();

/**
 * Loads a bundled font by ID and resolves to the CSS family name to draw it with. The
 * family is private to the app, so a system font of the same name is never used.
 * Failures reject, and the next call tries again.
 */
export function loadFont(id: string): Promise<string> {
  let pending = loading.get(id);
  if (pending === undefined) {
    const family = `eye-llusion-${id}`;
    pending = load(id, family).then(() => family);
    pending.catch(() => {
      loading.delete(id);
    });
    loading.set(id, pending);
  }
  return pending;
}
