import { strokeCost } from "../core/depth/drawing.ts";
import { RECIPE_LIMITS } from "../core/parseRecipe.ts";
import type { Layer, Stroke } from "../core/recipe.ts";

/** Whether the stack has room for another layer. */
export function canAddLayer(layers: readonly Layer[]): boolean {
  return layers.length < RECIPE_LIMITS.layers;
}

/** `${prefix}-N` with the smallest N ≥ 1 that no layer uses. */
export function freeLayerId(layers: readonly Layer[], prefix: string): string {
  const used = new Set(layers.map((layer) => layer.id));
  for (let n = 1; ; n++) {
    const id = `${prefix}-${String(n)}`;
    if (!used.has(id)) {
      return id;
    }
  }
}

/** `layer` with an ID and name that no layer in `layers` uses. */
export function withFreeIdentity<L extends Layer>(layers: readonly Layer[], layer: L): L {
  return {
    ...layer,
    id: freeLayerId(layers, layer.kind),
    name: freeLayerName(layers, layer.name),
  };
}

/** `base`, or `base N` with the smallest N ≥ 2 that no layer uses, within the name limit. */
export function freeLayerName(layers: readonly Layer[], base: string): string {
  const used = new Set(layers.map((layer) => layer.name));
  const clipped = base.slice(0, RECIPE_LIMITS.nameLength);
  if (!used.has(clipped)) {
    return clipped;
  }
  for (let n = 2; ; n++) {
    const suffix = ` ${String(n)}`;
    const name = base.slice(0, RECIPE_LIMITS.nameLength - suffix.length).trimEnd() + suffix;
    if (!used.has(name)) {
      return name;
    }
  }
}

/**
 * Inserts `layer` directly above the layer with ID `above`, or at the top when there is
 * no such layer. Returns `layers` unchanged when the stack is full.
 */
export function insertLayer(layers: Layer[], layer: Layer, above?: string): Layer[] {
  if (!canAddLayer(layers)) {
    return layers;
  }
  const index = layers.findIndex((each) => each.id === above);
  const at = index === -1 ? layers.length : index + 1;
  return [...layers.slice(0, at), layer, ...layers.slice(at)];
}

/** How many drawn points `layer` holds. */
function layerPoints(layer: Layer): number {
  if (layer.kind !== "drawing") {
    return 0;
  }
  let points = 0;
  for (const stroke of layer.strokes) {
    points += stroke.points.length / 2;
  }
  return points;
}

function totalPoints(layers: readonly Layer[]): number {
  let points = 0;
  for (const layer of layers) {
    points += layerPoints(layer);
  }
  return points;
}

/**
 * Whether the drawing in `layers`, on a canvas `aspect` times wider than it is tall, is
 * within the recipe's drawing area. Sums in the same order as the recipe parser, so
 * both agree at the limit.
 */
function withinDrawingArea(layers: readonly Layer[], aspect: number): boolean {
  let area = 0;
  for (const layer of layers) {
    if (layer.kind === "drawing") {
      for (const stroke of layer.strokes) {
        area += strokeCost(stroke, aspect);
      }
    }
  }
  return area <= RECIPE_LIMITS.drawingArea;
}

/** Why a copy of a layer wouldn't fit in the stack, if it wouldn't. */
type DuplicateProblem = "layers" | "points" | "drawingArea";

/**
 * What would stop a copy of the layer with ID `id` fitting in the stack on a canvas
 * `aspect` times wider than it is tall: no room for another layer, or too many drawn
 * points or too much drawing area in all. Undefined when it fits.
 */
export function duplicateProblem(
  layers: readonly Layer[],
  id: string,
  aspect: number,
): DuplicateProblem | undefined {
  const index = layers.findIndex((layer) => layer.id === id);
  if (index === -1 || !canAddLayer(layers)) {
    return "layers";
  }
  if (totalPoints(layers) + layerPoints(layers[index]) > RECIPE_LIMITS.pointsTotal) {
    return "points";
  }
  if (!withinDrawingArea(layers.toSpliced(index + 1, 0, layers[index]), aspect)) {
    return "drawingArea";
  }
  return undefined;
}

/** Whether a copy of the layer with ID `id` fits in the stack. */
export function canDuplicateLayer(layers: readonly Layer[], id: string, aspect: number): boolean {
  return duplicateProblem(layers, id, aspect) === undefined;
}

/**
 * A copy of the layer with ID `id`, with a fresh ID and name, inserted above it. Returns
 * `layers` unchanged when the copy wouldn't fit.
 */
export function duplicateLayer(layers: Layer[], id: string, aspect: number): Layer[] {
  const original = layers.find((layer) => layer.id === id);
  if (original === undefined || !canDuplicateLayer(layers, id, aspect)) {
    return layers;
  }
  const copy: Layer = {
    ...structuredClone(original),
    id: freeLayerId(layers, original.kind),
    name: freeLayerName(layers, `${original.name} copy`),
  };
  return insertLayer(layers, copy, id);
}

export function removeLayer(layers: Layer[], id: string): Layer[] {
  const index = layers.findIndex((layer) => layer.id === id);
  return index === -1 ? layers : layers.toSpliced(index, 1);
}

/** Moves the layer with ID `id` to position `to` in the stack, clamped to its ends. */
export function moveLayer(layers: Layer[], id: string, to: number): Layer[] {
  const from = layers.findIndex((layer) => layer.id === id);
  const target = Math.min(Math.max(to, 0), layers.length - 1);
  if (from === -1 || from === target) {
    return layers;
  }
  return layers.toSpliced(from, 1).toSpliced(target, 0, layers[from]);
}

/** Applies `change` to the layer with ID `id`. */
export function changeLayer(layers: Layer[], id: string, change: (layer: Layer) => Layer): Layer[] {
  const index = layers.findIndex((layer) => layer.id === id);
  return index === -1 ? layers : layers.with(index, change(layers[index]));
}

/** The layer with ID `id`, or the top layer if there is none. */
export function selectedLayer(layers: readonly Layer[], id: string | undefined): Layer | undefined {
  return layers.find((layer) => layer.id === id) ?? layers.at(-1);
}

/**
 * How many more points a new stroke on drawing layer `id` may have within the recipe's
 * caps: 0 when the layer has its most strokes.
 */
export function strokeRoom(layers: readonly Layer[], id: string): number {
  const points = totalPoints(layers);
  const layer = layers.find((each) => each.id === id);
  const strokes = layer?.kind === "drawing" ? layer.strokes.length : 0;
  return strokes >= RECIPE_LIMITS.strokesPerLayer
    ? 0
    : Math.max(0, Math.min(RECIPE_LIMITS.pointsPerStroke, RECIPE_LIMITS.pointsTotal - points));
}

/**
 * Whether `stroke` fits on drawing layer `id`, on a canvas `aspect` times wider than it
 * is tall, within the recipe's caps on strokes, points and drawing area.
 */
export function strokeFits(layers: Layer[], id: string, stroke: Stroke, aspect: number): boolean {
  return (
    stroke.points.length / 2 <= strokeRoom(layers, id) &&
    withinDrawingArea(addStroke(layers, id, stroke), aspect)
  );
}

/** Adds `stroke` to the top of drawing layer `id`. */
export function addStroke(layers: Layer[], id: string, stroke: Stroke): Layer[] {
  return changeLayer(layers, id, (layer) =>
    layer.kind === "drawing" ? { ...layer, strokes: [...layer.strokes, stroke] } : layer,
  );
}
