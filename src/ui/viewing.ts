/**
 * CSS pixels per physical inch. CSS defines 96 px to the inch and desktop monitors come
 * close, but phones pack their CSS pixels a third or so tighter, so every millimetre
 * figure here is an estimate. Device pixels divided by `devicePixelRatio` give CSS
 * pixels, so working in CSS pixels already accounts for the pixel ratio.
 */
const CSS_PX_PER_INCH = 96;
const MM_PER_INCH = 25.4;

const MIN_REPEATS = 2;
const MAX_REPEATS = 32;

type ViewingContext = "phone" | "monitor";

/**
 * Estimated far-plane strip widths, in millimetres, that are comfortable to view: phones
 * are held closer than monitors, so they suit narrower strips. `target` is what the
 * preset for that context aims for.
 */
export const STRIP_COMFORT = {
  phone: { min: 12, target: 22, max: 40 },
  monitor: { min: 18, target: 32, max: 55 },
} as const satisfies Record<ViewingContext, { min: number; target: number; max: number }>;

/** Estimated physical size of a length given in CSS pixels. */
export function cssPixelsToMillimetres(cssPixels: number): number {
  return (cssPixels / CSS_PX_PER_INCH) * MM_PER_INCH;
}

/** Repeats that bring the strip width of an image `imageWidth` CSS pixels wide to the context's target. */
export function presetRepeats(context: ViewingContext, imageWidth: number): number {
  const repeats = Math.round(cssPixelsToMillimetres(imageWidth) / STRIP_COMFORT[context].target);
  return Math.min(MAX_REPEATS, Math.max(MIN_REPEATS, repeats));
}

/** A gentle suggestion when a strip `stripMm` wide is outside the context's comfortable range. */
export function stripAdvice(
  context: ViewingContext,
  stripMm: number,
  portrait: boolean,
): string | undefined {
  const { min, max } = STRIP_COMFORT[context];
  if (stripMm < min) {
    if (context === "phone") {
      return portrait
        ? "The pattern is quite fine here. Try rotating to landscape for a wider image."
        : "The pattern is quite fine here. Try the Phone preset for wider strips.";
    }
    return "The pattern is quite fine here. Try zooming in or the Monitor preset.";
  }
  if (stripMm > max) {
    return context === "phone"
      ? "The pattern is quite wide here. Try the Phone preset for narrower strips."
      : "The pattern is quite wide here. Try zooming out or the Monitor preset.";
  }
  return undefined;
}
