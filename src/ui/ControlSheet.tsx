import type { ComponentChildren } from "preact";
import { useId, useRef, useState } from "preact/hooks";

export type SheetSnap = "peek" | "half" | "full";

/**
 * Resting heights of the bottom sheet on narrow screens: CSS pixels for the peek and
 * fractions of the screen for the others. app.css uses the same values.
 */
const PEEK_HEIGHT = 128;
const SNAP_FRACTIONS = { half: 0.5, full: 0.88 } as const;

/** Pointer travel, in CSS pixels, that turns a press on the handle into a drag. */
const DRAG_THRESHOLD = 6;

type Props = {
  snap: SheetSnap;
  onSnap: (snap: SheetSnap) => void;
  children: ComponentChildren;
};

type Drag = { pointerId: number; startY: number; startHeight: number; moved: boolean };

/** The snap whose resting height is closest to `height` on a screen `limit` tall. */
function nearestSnap(height: number, limit: number): SheetSnap {
  const rests: [SheetSnap, number][] = [
    ["peek", PEEK_HEIGHT],
    ["half", SNAP_FRACTIONS.half * limit],
    ["full", SNAP_FRACTIONS.full * limit],
  ];
  let [best] = rests[0];
  let bestDistance = Infinity;
  for (const [snap, rest] of rests) {
    const distance = Math.abs(rest - height);
    if (distance < bestDistance) {
      best = snap;
      bestDistance = distance;
    }
  }
  return best;
}

function screenHeight(sheet: HTMLElement): number {
  return sheet.parentElement?.getBoundingClientRect().height ?? window.innerHeight;
}

/**
 * The controls: a side panel on wide screens and, on narrow ones, a bottom sheet that
 * can be dragged by its handle between resting heights, or toggled by pressing it.
 */
export function ControlSheet({ snap, onSnap, children }: Props) {
  const sheetRef = useRef<HTMLElement>(null);
  const drag = useRef<Drag | undefined>(undefined);
  const [dragging, setDragging] = useState(false);
  const bodyId = useId();

  const end = (event: PointerEvent): void => {
    const current = drag.current;
    const sheet = sheetRef.current;
    if (current?.pointerId !== event.pointerId || sheet === null) {
      return;
    }
    if (current.moved) {
      onSnap(nearestSnap(sheet.getBoundingClientRect().height, screenHeight(sheet)));
    }
    sheet.style.removeProperty("--sheet-drag");
    setDragging(false);
  };

  return (
    <aside
      ref={sheetRef}
      class={dragging ? "sheet dragging" : "sheet"}
      data-snap={snap}
      aria-label="Controls"
    >
      <button
        type="button"
        class="sheet-handle"
        aria-label="Controls"
        aria-expanded={snap !== "peek"}
        aria-controls={bodyId}
        onPointerDown={(event) => {
          const sheet = sheetRef.current;
          if (sheet === null || event.button !== 0) {
            return;
          }
          event.currentTarget.setPointerCapture(event.pointerId);
          drag.current = {
            pointerId: event.pointerId,
            startY: event.clientY,
            startHeight: sheet.getBoundingClientRect().height,
            moved: false,
          };
        }}
        onPointerMove={(event) => {
          const current = drag.current;
          const sheet = sheetRef.current;
          if (current?.pointerId !== event.pointerId || sheet === null) {
            return;
          }
          const travel = current.startY - event.clientY;
          if (!current.moved && Math.abs(travel) < DRAG_THRESHOLD) {
            return;
          }
          if (!current.moved) {
            current.moved = true;
            setDragging(true);
          }
          const height = Math.min(screenHeight(sheet), Math.max(0, current.startHeight + travel));
          sheet.style.setProperty("--sheet-drag", `${String(height)}px`);
        }}
        onPointerUp={end}
        onPointerCancel={end}
        onClick={() => {
          const current = drag.current;
          drag.current = undefined;
          if (current?.moved === true) {
            return;
          }
          onSnap(snap === "peek" ? "half" : "peek");
        }}
      >
        <span class="sheet-grip" />
      </button>
      <div class="sheet-body" id={bodyId}>
        {children}
      </div>
    </aside>
  );
}
