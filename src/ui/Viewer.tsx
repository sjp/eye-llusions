import { useEffect, useId, useRef, useState } from "preact/hooks";
import type { Editor } from "../state/editor.ts";
import { Preview, type Renderer } from "./Preview.tsx";
import {
  cssPixelsToMillimetres,
  presetRepeats,
  type STRIP_COMFORT,
  stripAdvice,
} from "./viewing.ts";

type Context = keyof typeof STRIP_COMFORT;

/** Height of the row of alignment dots above the image, in CSS pixels; app.css matches. */
const DOT_ROW = 28;

/** A press on Peek at least this long, in milliseconds, is a hold rather than a tap. */
const HOLD_MS = 300;

type Props = {
  editor: Editor;
  renderer: Renderer;
  onExit: () => void;
  /** Whether the how-to-view instructions are open. */
  help: boolean;
  onHelp: (open: boolean) => void;
};

type Size = { width: number; height: number };

function viewingContext(): Context {
  return window.matchMedia("(pointer: coarse)").matches ? "phone" : "monitor";
}

function useSize(ref: { current: HTMLElement | null }): Size {
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });
  useEffect(() => {
    const element = ref.current;
    if (element === null) {
      return undefined;
    }
    const measure = (): void => {
      const { width, height } = element.getBoundingClientRect();
      setSize((old) => (old.width === width && old.height === height ? old : { width, height }));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [ref]);
  return size;
}

function PeekButton({ peeking, onPeek }: { peeking: boolean; onPeek: (on: boolean) => void }) {
  const press = useRef<{ start: number; was: boolean; released: boolean } | undefined>(undefined);
  const release = (event: PointerEvent): void => {
    const current = press.current;
    if (current === undefined || current.released) {
      return;
    }
    current.released = true;
    if (current.was || event.timeStamp - current.start >= HOLD_MS) {
      onPeek(false);
    }
  };
  // Without a release, no click follows to end the press.
  const abandon = (event: PointerEvent): void => {
    if (press.current?.released === false) {
      release(event);
      press.current = undefined;
    }
  };
  return (
    <button
      type="button"
      class="button viewer-peek"
      aria-pressed={peeking}
      title="Tap to switch to the depth map, or hold to peek"
      onPointerDown={(event) => {
        if (event.button !== 0) {
          return;
        }
        try {
          event.currentTarget.setPointerCapture(event.pointerId);
        } catch {
          // Capture is a nicety; synthetic pointers may not support it.
        }
        press.current = { start: event.timeStamp, was: peeking, released: false };
        onPeek(true);
      }}
      onPointerUp={release}
      onPointerCancel={abandon}
      onLostPointerCapture={abandon}
      onContextMenu={(event) => {
        event.preventDefault();
      }}
      onClick={() => {
        if (press.current !== undefined) {
          press.current = undefined;
          return;
        }
        // Keyboard activation toggles.
        onPeek(!peeking);
      }}
    >
      Peek
    </button>
  );
}

const HOW_TO = {
  wall: "This image is made for wall-eyed viewing.",
  cross: "This image is made for cross-eyed viewing.",
} as const;

function HowTo({ mode, onClose }: { mode: "wall" | "cross"; onClose: () => void }) {
  const titleId = useId();
  return (
    <section class="viewer-help" aria-labelledby={titleId}>
      <h2 id={titleId}>How to view</h2>
      <p>{HOW_TO[mode]}</p>
      <p>
        <strong>Wall-eyed:</strong> bring your face close to the screen and look through it, as if
        at something far away. Move back slowly, keeping your eyes relaxed, until the two dots
        become three and the hidden shape appears.
      </p>
      <p>
        <strong>Cross-eyed:</strong> hold a fingertip between your eyes and the screen and focus on
        it, moving it until the two dots behind it become three. Then let your gaze rest on the
        image.
      </p>
      <button type="button" class="button" onClick={onClose}>
        Got it
      </button>
    </section>
  );
}

/**
 * The distraction-free viewer: the stereogram as large as the screen allows, with
 * alignment dots one far-plane strip apart above it and help for seeing it.
 */
export function Viewer({ editor, renderer, onExit, help, onHelp }: Props) {
  const areaRef = useRef<HTMLDivElement>(null);
  const exitRef = useRef<HTMLButtonElement>(null);
  const area = useSize(areaRef);
  const [context] = useState(viewingContext);
  const [peeking, setPeeking] = useState(false);
  const { aspect, view } = editor.recipe.value;

  useEffect(() => {
    exitRef.current?.focus();
  }, []);

  const width = Math.max(0, Math.min(area.width, (area.height - DOT_ROW) * aspect));
  const height = width / aspect;
  const strip = width / view.repeats;
  const stripMm = cssPixelsToMillimetres(strip);
  const advice = width > 0 ? stripAdvice(context, stripMm, area.height > area.width) : undefined;
  const preset = (target: Context): void => {
    editor.setView({ repeats: presetRepeats(target, width) });
  };

  return (
    <div class="viewer" role="dialog" aria-label="Viewer">
      <div class="viewer-bar">
        <button ref={exitRef} type="button" class="button" onClick={onExit}>
          Exit
        </button>
        <PeekButton peeking={peeking} onPeek={setPeeking} />
        <div class="viewer-presets" role="group" aria-label="Size the pattern for">
          <button
            type="button"
            class="button"
            disabled={width <= 0}
            onClick={() => {
              preset("phone");
            }}
          >
            Phone
          </button>
          <button
            type="button"
            class="button"
            disabled={width <= 0}
            onClick={() => {
              preset("monitor");
            }}
          >
            Monitor
          </button>
        </div>
        <button
          type="button"
          class="button"
          aria-expanded={help}
          onClick={() => {
            onHelp(!help);
          }}
        >
          How to view
        </button>
      </div>
      <div class="viewer-area" ref={areaRef}>
        <div class="viewer-picture" style={{ width: `${String(width)}px` }}>
          <div class="viewer-dots" aria-hidden="true">
            <span class="viewer-dot" style={{ left: `calc(50% - ${String(strip / 2)}px)` }} />
            <span class="viewer-dot" style={{ left: `calc(50% + ${String(strip / 2)}px)` }} />
          </div>
          <div class="viewer-frame" style={{ height: `${String(height)}px` }}>
            <Preview
              editor={editor}
              renderer={renderer}
              output={peeking ? "depth" : "stereogram"}
            />
          </div>
        </div>
      </div>
      <div class="viewer-guide">
        <p>
          {view.mode === "wall" ? "Relax" : "Cross"} your eyes until you see three dots.{" "}
          <span class="viewer-strip">Strips are about {Math.round(stripMm)} mm wide.</span>
        </p>
        <p class="viewer-advice" aria-live="polite">
          {advice}
        </p>
      </div>
      {help ? (
        <HowTo
          mode={view.mode}
          onClose={() => {
            onHelp(false);
          }}
        />
      ) : null}
    </div>
  );
}
