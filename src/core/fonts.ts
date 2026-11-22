type Font = {
  id: string;
  label: string;
  /** Height of a capital letter above the baseline, in ems. */
  capHeight: number;
};

/** The fonts bundled with the app, referenced by ID from text layers. */
export const FONTS: readonly Font[] = [
  { id: "anton", label: "Anton", capHeight: 0.86 },
  { id: "archivo-black", label: "Archivo Black", capHeight: 0.704 },
  { id: "alfa-slab-one", label: "Alfa Slab One", capHeight: 0.782 },
];

/**
 * Code points every bundled font is shipped for (Latin and Latin Extended), as
 * inclusive ranges. Other characters would be drawn in whatever font the device has.
 */
const COVERED: readonly (readonly [number, number])[] = [
  [0x0000, 0x02ff],
  [0x1d00, 0x1dbf],
  [0x1e00, 0x1eff],
  [0x2000, 0x206f],
  [0x20a0, 0x20c0],
  [0x2113, 0x2113],
  [0x2122, 0x2122],
  [0x2191, 0x2191],
  [0x2193, 0x2193],
  [0x2212, 0x2212],
  [0x2215, 0x2215],
  [0x2c60, 0x2c7f],
  [0xa720, 0xa7ff],
  [0xfeff, 0xfeff],
  [0xfffd, 0xfffd],
];

/** The distinct characters of `text` that the bundled fonts don't cover. */
export function uncoveredCharacters(text: string): string[] {
  const found = new Set<string>();
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0;
    if (!COVERED.some(([low, high]) => code >= low && code <= high)) {
      found.add(character);
    }
  }
  return [...found];
}
