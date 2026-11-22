/** Zoom and pan of the preview: translate by `x`, `y` CSS pixels, then scale about the centre. */
export type ViewTransform = { scale: number; x: number; y: number };

export const IDENTITY: ViewTransform = { scale: 1, x: 0, y: 0 };

const MAX_SCALE = 8;

type Vector = { x: number; y: number };

/** A pinch or pan in client coordinates: the midpoint of the fingers and their spread. */
export type Grip = Vector & { spread: number };

type Surface = {
  /** Centre of the unzoomed surface, in client coordinates. */
  centre: Vector;
  /** Unzoomed size, in CSS pixels. */
  width: number;
  height: number;
};

export function cssTransform({ scale, x, y }: ViewTransform): string {
  return `translate(${String(x)}px, ${String(y)}px) scale(${String(scale)})`;
}

/** Keeps the scale between 1 and the maximum and some of the surface on screen. */
function clamp(view: ViewTransform, surface: Surface): ViewTransform {
  const scale = Math.min(MAX_SCALE, Math.max(1, view.scale));
  const reachX = (surface.width * scale) / 2;
  const reachY = (surface.height * scale) / 2;
  return {
    scale,
    x: Math.min(reachX, Math.max(-reachX, view.x)),
    y: Math.min(reachY, Math.max(-reachY, view.y)),
  };
}

/**
 * The view after the fingers move from grip `from` to `to`, starting from `start`: the
 * point of the picture under the starting midpoint follows the midpoint, and the picture
 * scales with the spread. One finger pans with a constant spread.
 */
export function moveGrip(
  start: ViewTransform,
  surface: Surface,
  from: Grip,
  to: Grip,
): ViewTransform {
  const scale = Math.min(
    MAX_SCALE,
    Math.max(1, from.spread > 0 ? (start.scale * to.spread) / from.spread : start.scale),
  );
  // The picture point under the starting midpoint, relative to the centre, unscaled.
  const px = (from.x - surface.centre.x - start.x) / start.scale;
  const py = (from.y - surface.centre.y - start.y) / start.scale;
  return clamp(
    { scale, x: to.x - surface.centre.x - scale * px, y: to.y - surface.centre.y - scale * py },
    surface,
  );
}

/** The grip of one or two pointers. */
export function gripOf(points: readonly Vector[]): Grip {
  const [a, b] = points;
  if (points.length < 2) {
    return { x: a.x, y: a.y, spread: 1 };
  }
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, spread: Math.hypot(b.x - a.x, b.y - a.y) };
}
