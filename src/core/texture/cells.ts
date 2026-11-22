import { cellHash, UINT32_RANGE } from "./context.ts";

/**
 * Voronoi cells around one jittered point per square of `spacing` pixels. Each cell has
 * its own random value; `shading` darkens it towards the borders with its neighbours.
 */
export function voronoiCells(
  pointKey: number,
  valueKey: number,
  spacing: number,
  shading: number,
): (x: number, y: number) => number {
  return (x, y) => {
    const gx = x / spacing;
    const gy = y / spacing;
    const ix = Math.floor(gx);
    const iy = Math.floor(gy);
    let nearest = Infinity;
    let second = Infinity;
    let cx = 0;
    let cy = 0;
    for (let j = iy - 1; j <= iy + 1; j++) {
      for (let i = ix - 1; i <= ix + 1; i++) {
        const hash = cellHash(pointKey, i, j);
        const dx = i + (hash & 0xffff) / 0x1_0000 - gx;
        const dy = j + (hash >>> 16) / 0x1_0000 - gy;
        const distance = dx * dx + dy * dy;
        if (distance < nearest) {
          second = nearest;
          nearest = distance;
          cx = i;
          cy = j;
        } else if (distance < second) {
          second = distance;
        }
      }
    }
    const value = cellHash(valueKey, cx, cy) / UINT32_RANGE;
    if (shading === 0) {
      return value;
    }
    // Half the gap between the two nearest points is roughly the distance to the border.
    const border = Math.min(1, (Math.sqrt(second) - Math.sqrt(nearest)) * 2.5);
    return value * (1 - shading * (1 - border));
  };
}
