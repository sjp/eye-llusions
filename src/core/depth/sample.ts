import type { SampleLayer, SampleShape } from "../recipe.ts";
import type { RasterContext } from "./raster.ts";

const TAU = 2 * Math.PI;

/**
 * A shape on the unit disc, in coordinates `(u, v)` scaled so the shape's radius is 1,
 * with `v` pointing down and `r` the distance from the centre. `height` runs from 0 to
 * 1; `inside` is the distance in from the shape's edge, in the same units, and is
 * negative outside it.
 */
type ShapeFunctions = {
  height: (u: number, v: number, r: number) => number;
  inside: (u: number, v: number, r: number) => number;
};

const disc = (_u: number, _v: number, r: number) => 1 - r;

function sphere(): ShapeFunctions {
  return { height: (_u, _v, r) => (r < 1 ? Math.sqrt(1 - r * r) : 0), inside: disc };
}

/**
 * Concentric waves under a cone: `rings` crests, counting the peak in the centre, with
 * a trough at the rim.
 */
function ripples(rings: number): ShapeFunctions {
  const frequency = TAU * (rings - 0.5);
  return {
    height: (_u, _v, r) => (r < 1 ? (1 - r) * (0.5 + 0.5 * Math.cos(frequency * r)) : 0),
    inside: disc,
  };
}

/** A regular polygon pyramid with a vertex pointing up, inscribed in the unit circle. */
function pyramid(sides: number): ShapeFunctions {
  const wedge = TAU / sides;
  const apothem = Math.cos(Math.PI / sides);
  /** The point's distance out towards the edge, as a fraction of the way from the centre. */
  const extent = (u: number, v: number, r: number) => {
    const angle = Math.atan2(v, u) + Math.PI / 2 - Math.PI / sides;
    const offset = angle - wedge * Math.round(angle / wedge);
    return (r * Math.cos(offset)) / apothem;
  };
  return {
    height: (u, v, r) => Math.max(0, 1 - extent(u, v, r)),
    inside: (u, v, r) => (1 - extent(u, v, r)) * apothem,
  };
}

/** A ring with a round cross-section; `thickness` is the tube's diameter. */
function torus(thickness: number): ShapeFunctions {
  const tube = thickness / 2;
  const ring = 1 - tube;
  return {
    height: (_u, _v, r) => {
      const across = (r - ring) / tube;
      return across * across < 1 ? Math.sqrt(1 - across * across) : 0;
    },
    inside: (_u, _v, r) => tube - Math.abs(r - ring),
  };
}

/**
 * Flat steps descending clockwise along an Archimedean spiral from the centre to the
 * rim. `steps` counts every step across all `turns`.
 */
function spiralStairs(steps: number, turns: number): ShapeFunctions {
  return {
    height: (u, v, r) => {
      if (r >= 1) {
        return 0;
      }
      const turn = Math.atan2(u, -v) / TAU;
      const fraction = turn - Math.floor(turn);
      const arm = Math.floor(r * turns - fraction);
      const along = Math.min(Math.max((arm + fraction) / turns, 0), 1);
      return 1 - Math.min(Math.floor(along * steps), steps - 1) / steps;
    },
    inside: disc,
  };
}

function shapeFunctions(shape: SampleShape): ShapeFunctions {
  switch (shape.type) {
    case "sphere":
      return sphere();
    case "ripples":
      return ripples(shape.rings);
    case "pyramid":
      return pyramid(shape.sides);
    case "torus":
      return torus(shape.thickness);
    case "spiralStairs":
      return spiralStairs(shape.steps, shape.turns);
    default:
      throw new RangeError("unknown sample shape");
  }
}

/**
 * Rasterises a procedural shape centred on `layer.center`, `layer.size` canvas heights
 * across. Coverage fades over about one pixel at the shape's edge.
 */
export function rasteriseSample(
  layer: SampleLayer,
  { width, height, target }: RasterContext,
): void {
  const { height: shapeHeight, inside } = shapeFunctions(layer.shape);
  const radius = (layer.size / 2) * height;
  const cx = layer.center.x * width;
  const cy = layer.center.y * height;
  const x0 = Math.max(0, Math.floor(cx - radius - 1));
  const x1 = Math.min(width, Math.ceil(cx + radius + 1));
  const y0 = Math.max(0, Math.floor(cy - radius - 1));
  const y1 = Math.min(height, Math.ceil(cy + radius + 1));
  for (let y = y0; y < y1; y++) {
    const v = (y + 0.5 - cy) / radius;
    for (let x = x0; x < x1; x++) {
      const u = (x + 0.5 - cx) / radius;
      const r = Math.hypot(u, v);
      const alpha = inside(u, v, r) * radius + 0.5;
      if (alpha <= 0) {
        continue;
      }
      const i = y * width + x;
      target.coverage[i] = alpha < 1 ? alpha : 1;
      target.depth[i] = shapeHeight(u, v, r);
    }
  }
}
