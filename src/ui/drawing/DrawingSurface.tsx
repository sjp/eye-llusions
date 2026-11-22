import type { ReadonlySignal, Signal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import type { Brush, Recipe, Stroke } from "../../core/recipe.ts";
import { finishStroke } from "../../core/strokes.ts";
import type { Editor } from "../../state/editor.ts";
import { addStroke, strokeRoom } from "../../state/layers.ts";
import { gripOf, moveGrip, type Grip, type ViewTransform } from "./navigation.ts";
import type { DrawingTools } from "./tools.ts";

type Props = {
  editor: Editor;
  layerId: string;
  /** The layer's stroke count, shown as `data-strokes`. */
  strokes: number;
  tools: DrawingTools;
  view: Signal<ViewTransform>;
  /** The recipe the preview shows now. */
  shown: ReadonlySignal<Recipe | undefined>;
};

type Vector = { x: number; y: number };

type Live = {
  pointerId: number;
  brush: Brush;
  pen: boolean;
  /** Normalised canvas coordinates, flattened. */
  points: number[];
  pressure: number;
};

type Navigation = {
  start: ViewTransform;
  from: Grip;
  surface: { centre: Vector; width: number; height: number };
};

/** Largest backing size of the live stroke canvas, in device pixels per side. */
const MAX_OVERLAY_SIDE = 4096;

const LIVE_COLOUR = "rgba(124, 196, 255, 0.6)";

/**
 * A transparent canvas over the preview that turns pointer input into strokes on a
 * drawing layer, and pinches and drags into zooming and panning. Strokes show here
 * straight away and stay until the preview has rendered them.
 */
export function DrawingSurface({ editor, layerId, strokes, tools, view, shown }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pointers = useRef(new Map<number, Vector>());
  const live = useRef<Live | undefined>(undefined);
  const navigation = useRef<Navigation | undefined>(undefined);
  /** Committed strokes the preview hasn't shown yet, and the recipe that holds them. */
  const waiting = useRef<{ recipe: Recipe; strokes: Live[] } | undefined>(undefined);

  const context = (): CanvasRenderingContext2D | null =>
    canvasRef.current?.getContext("2d") ?? null;

  const surfaceOf = (canvas: HTMLCanvasElement, start: ViewTransform): Navigation["surface"] => {
    const rect = canvas.getBoundingClientRect();
    return {
      centre: { x: rect.left + rect.width / 2 - start.x, y: rect.top + rect.height / 2 - start.y },
      width: rect.width / start.scale,
      height: rect.height / start.scale,
    };
  };

  const paint = (): void => {
    const canvas = canvasRef.current;
    const ctx = context();
    if (canvas === null || ctx === null) {
      return;
    }
    const { width, height } = canvas;
    ctx.clearRect(0, 0, width, height);
    ctx.strokeStyle = LIVE_COLOUR;
    ctx.fillStyle = LIVE_COLOUR;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    const shownStrokes = [...(waiting.current?.strokes ?? [])];
    if (live.current !== undefined) {
      shownStrokes.push(live.current);
    }
    for (const { brush, points } of shownStrokes) {
      const radius = (brush.size * height) / 2;
      ctx.lineWidth = radius * 2;
      ctx.beginPath();
      if (points.length === 2) {
        ctx.arc(points[0] * width, points[1] * height, radius, 0, 2 * Math.PI);
        ctx.fill();
        continue;
      }
      ctx.moveTo(points[0] * width, points[1] * height);
      for (let i = 2; i < points.length; i += 2) {
        ctx.lineTo(points[i] * width, points[i + 1] * height);
      }
      ctx.stroke();
    }
  };

  useEffect(
    () =>
      shown.subscribe((recipe) => {
        const pending = waiting.current;
        if (
          pending !== undefined &&
          (recipe === pending.recipe || editor.recipe.peek() !== pending.recipe)
        ) {
          waiting.current = undefined;
          paint();
        }
      }),
    [shown, editor],
  );

  const normalised = (event: PointerEvent): Vector => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (rect === undefined || rect.width === 0 || rect.height === 0) {
      return { x: 0, y: 0 };
    }
    return {
      x: (event.clientX - rect.left) / rect.width,
      y: (event.clientY - rect.top) / rect.height,
    };
  };

  const startStroke = (event: PointerEvent): void => {
    const canvas = canvasRef.current;
    if (canvas === null) {
      return;
    }
    const density = Math.min(
      (window.devicePixelRatio || 1) * view.peek().scale,
      MAX_OVERLAY_SIDE / Math.max(1, canvas.clientWidth, canvas.clientHeight),
    );
    canvas.width = Math.max(1, Math.round(canvas.clientWidth * density));
    canvas.height = Math.max(1, Math.round(canvas.clientHeight * density));
    const point = normalised(event);
    const pen = event.pointerType === "pen";
    live.current = {
      pointerId: event.pointerId,
      brush: tools.brush.peek(),
      pen,
      points: [point.x, point.y],
      pressure: pen ? event.pressure : 0,
    };
    paint();
  };

  const commitStroke = (stroke: Live): void => {
    live.current = undefined;
    const count = stroke.points.length / 2;
    const recipe = editor.recipe.peek();
    // A pen's average pressure scales the brush, from half size to one and a half.
    const pressure = stroke.pen ? stroke.pressure / count : 0.5;
    const size = Math.min(1, Math.max(0.001, stroke.brush.size * (0.5 + pressure)));
    const finished: Stroke = {
      brush: { ...stroke.brush, size },
      points: finishStroke(stroke.points, recipe.aspect, size),
    };
    const fits = finished.points.length / 2 <= strokeRoom(recipe.layers, layerId);
    tools.full.value = !fits;
    if (fits) {
      editor.updateLayers((layers) => addStroke(layers, layerId, finished));
      waiting.current = {
        recipe: editor.recipe.peek(),
        strokes: [...(waiting.current?.strokes ?? []), { ...stroke, brush: finished.brush }],
      };
    }
    paint();
  };

  const cancelStroke = (): void => {
    live.current = undefined;
    paint();
  };

  const startNavigation = (): void => {
    const canvas = canvasRef.current;
    if (canvas === null) {
      navigation.current = undefined;
      return;
    }
    const start = view.peek();
    navigation.current = {
      start,
      from: gripOf([...pointers.current.values()].slice(0, 2)),
      surface: surfaceOf(canvas, start),
    };
  };

  const onPointerDown = (event: PointerEvent): void => {
    if (event.pointerType === "mouse" && event.button !== 0) {
      return;
    }
    event.preventDefault();
    try {
      canvasRef.current?.setPointerCapture(event.pointerId);
    } catch {
      // Capture is a nicety; synthetic pointers may not support it.
    }
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.current.size === 1 && tools.tool.peek() === "draw") {
      startStroke(event);
      return;
    }
    if (live.current !== undefined) {
      cancelStroke();
    }
    startNavigation();
  };

  const onPointerMove = (event: PointerEvent): void => {
    if (!pointers.current.has(event.pointerId)) {
      return;
    }
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const stroke = live.current;
    if (stroke?.pointerId === event.pointerId) {
      const events =
        typeof event.getCoalescedEvents === "function" ? event.getCoalescedEvents() : [];
      for (const each of events.length > 0 ? events : [event]) {
        const point = normalised(each);
        stroke.points.push(point.x, point.y);
        if (stroke.pen) {
          stroke.pressure += each.pressure;
        }
      }
      paint();
      return;
    }
    const nav = navigation.current;
    if (nav !== undefined) {
      view.value = moveGrip(
        nav.start,
        nav.surface,
        nav.from,
        gripOf([...pointers.current.values()].slice(0, 2)),
      );
    }
  };

  const onPointerEnd = (event: PointerEvent, cancelled: boolean): void => {
    if (!pointers.current.delete(event.pointerId)) {
      return;
    }
    const stroke = live.current;
    if (stroke?.pointerId === event.pointerId) {
      if (cancelled) {
        cancelStroke();
      } else {
        commitStroke(stroke);
      }
      return;
    }
    if (pointers.current.size === 0) {
      navigation.current = undefined;
    } else if (navigation.current !== undefined) {
      startNavigation();
    }
  };

  const onWheel = (event: WheelEvent): void => {
    const canvas = canvasRef.current;
    if (canvas === null) {
      return;
    }
    event.preventDefault();
    const start = view.peek();
    const at = { x: event.clientX, y: event.clientY };
    view.value = moveGrip(
      start,
      surfaceOf(canvas, start),
      { ...at, spread: 1 },
      { ...at, spread: Math.exp(-event.deltaY / 400) },
    );
  };

  return (
    <canvas
      ref={canvasRef}
      class="drawing-surface"
      data-tool={tools.tool.value}
      data-strokes={strokes}
      aria-label="Drawing surface"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(event) => {
        onPointerEnd(event, false);
      }}
      onPointerCancel={(event) => {
        onPointerEnd(event, true);
      }}
      onWheel={onWheel}
      onContextMenu={(event) => {
        event.preventDefault();
      }}
    />
  );
}
