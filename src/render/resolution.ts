/** Most pixels a preview renders, about 4 megapixels. */
export const PREVIEW_MAX_PIXELS = 4_000_000;

/** Linear scale of a draft render relative to the full preview. */
export const DRAFT_SCALE = 0.5;

/** Quiet time after the last change before a full render replaces the draft. */
export const SETTLE_DELAY_MS = 150;

type RenderQuality = "draft" | "full";

type Size = { width: number; height: number };

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
  let width = Math.max(0, box.width) * pixelRatio;
  let height = width / aspect;
  if (height > box.height * pixelRatio) {
    height = Math.max(0, box.height) * pixelRatio;
    width = height * aspect;
  }
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
