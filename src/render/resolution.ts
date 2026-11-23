/** Most pixels a preview renders, about 4 megapixels. */
export const PREVIEW_MAX_PIXELS = 4_000_000;

/** Linear scale of a draft render relative to the full preview. */
export const DRAFT_SCALE = 0.5;

/**
 * Horizontal supersampling of a full preview, for finer depth steps within the frame
 * budget. Drafts aren't supersampled.
 */
export const PREVIEW_OVERSAMPLE = 2;

/** Horizontal supersampling of an exported image. */
export const EXPORT_OVERSAMPLE = 4;

/** Quiet time after the last change before a full render replaces the draft. */
export const SETTLE_DELAY_MS = 150;

type RenderQuality = "draft" | "full";

type Size = { width: number; height: number };

/** The largest size with the given aspect that fits `box` at `pixelRatio`, in device pixels. */
function fitDevicePixels(aspect: number, box: Size, pixelRatio: number): Size {
  let width = Math.max(0, box.width) * pixelRatio;
  let height = width / aspect;
  if (height > box.height * pixelRatio) {
    height = Math.max(0, box.height) * pixelRatio;
    width = height * aspect;
  }
  return { width, height };
}

/**
 * Pixel size of a preview with the given aspect (width / height) that fits `box`, in
 * CSS pixels, at `pixelRatio` device pixels per CSS pixel. Full previews are capped at
 * `PREVIEW_MAX_PIXELS`; drafts are scaled down further by `DRAFT_SCALE`.
 */
export function previewSize(
  aspect: number,
  box: Size,
  pixelRatio: number,
  quality: RenderQuality,
): Size {
  const { width, height } = fitDevicePixels(aspect, box, pixelRatio);
  let scale = 1;
  if (width * height > PREVIEW_MAX_PIXELS) {
    scale = Math.sqrt(PREVIEW_MAX_PIXELS / (width * height));
  }
  if (quality === "draft") {
    scale *= DRAFT_SCALE;
  }
  return {
    width: Math.max(1, Math.floor(width * scale)),
    height: Math.max(1, Math.floor(height * scale)),
  };
}

/**
 * CSS size at which to show a preview that fits `box`: whole device pixels, so a full
 * preview below the cap is shown one pixel per device pixel, without resampling.
 */
export function previewDisplaySize(aspect: number, box: Size, pixelRatio: number): Size {
  const { width, height } = fitDevicePixels(aspect, box, pixelRatio);
  return {
    width: Math.max(1, Math.floor(width)) / pixelRatio,
    height: Math.max(1, Math.floor(height)) / pixelRatio,
  };
}

type PreviewScheduler = {
  /** Call on every change: renders a draft now and a full render once changes settle. */
  change: () => void;
  /** Renders at full quality now, cancelling any pending settle. */
  flush: () => void;
  cancel: () => void;
};

/**
 * Drives draft-while-changing, full-on-settle rendering. `render` is called with the
 * quality to render at.
 */
export function createPreviewScheduler(
  render: (quality: RenderQuality) => void,
  settleDelay = SETTLE_DELAY_MS,
): PreviewScheduler {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cancel = (): void => {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
  };
  const flush = (): void => {
    cancel();
    render("full");
  };
  return {
    change: () => {
      cancel();
      render("draft");
      timer = setTimeout(flush, settleDelay);
    },
    flush,
    cancel,
  };
}

/**
 * Most pixels an exported image may have: 4096², the largest canvas iPhones and iPads
 * can draw and encode.
 */
export const EXPORT_MAX_PIXELS = 4096 * 4096;

/** Exports above this many pixels (4K UHD) may run out of memory on phones. */
export const EXPORT_LARGE_PIXELS = 3840 * 2160;

/** Narrowest custom export, in pixels. */
export const EXPORT_MIN_WIDTH = 64;

/** Named export sizes as boxes, long side first; the box turns with the picture. */
export const EXPORT_PRESETS = [
  { id: "phone", label: "Phone wallpaper", long: 2796, short: 1290 },
  { id: "hd", label: "1080p", long: 1920, short: 1080 },
  { id: "4k", label: "4K", long: 3840, short: 2160 },
  { id: "a4", label: "A4 print, 300 DPI", long: 3508, short: 2480 },
] as const;

type ExportPreset = (typeof EXPORT_PRESETS)[number];

/** Widest export allowed at `aspect` (width / height). */
export function maxExportWidth(aspect: number): number {
  let width = Math.floor(Math.sqrt(EXPORT_MAX_PIXELS * aspect));
  while (width * Math.max(1, Math.round(width / aspect)) > EXPORT_MAX_PIXELS) {
    width -= 1;
  }
  return width;
}

/** The export `width` pixels wide at `aspect`, with width clamped to the allowed range. */
export function exportSizeForWidth(aspect: number, width: number): Size {
  const clamped = Math.round(Math.min(Math.max(width, EXPORT_MIN_WIDTH), maxExportWidth(aspect)));
  return { width: clamped, height: Math.max(1, Math.round(clamped / aspect)) };
}

/** The largest size at `aspect` that fits the preset's box, turned to match the picture. */
export function presetExportSize(aspect: number, preset: ExportPreset): Size {
  const box =
    aspect >= 1
      ? { width: preset.long, height: preset.short }
      : { width: preset.short, height: preset.long };
  return exportSizeForWidth(aspect, Math.min(box.width, box.height * aspect));
}
