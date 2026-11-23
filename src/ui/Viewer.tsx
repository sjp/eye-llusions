import { useEffect, useId, useLayoutEffect, useRef, useState } from "preact/hooks";
import { previewDisplaySize } from "../render/resolution.ts";
import { Editor } from "../state/editor.ts";
import { PRACTICE_TARGET, practiceRecipe } from "./practice.ts";
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

/** Each zoom button press scales the picture by this much. */
const ZOOM_STEP = 1.25;
/** The zoom range, relative to the picture fitting the screen. */
const MIN_ZOOM = ZOOM_STEP ** -6;
const MAX_ZOOM = ZOOM_STEP ** 6;

/** A press on Peek at least this long, in milliseconds, is a hold rather than a tap. */
const HOLD_MS = 300;

type Props = {
  editor: Editor;
  renderer: Renderer;
  onExit: () => void;
  /** Whether the how-to-view instructions are open. */
  help: boolean;
  onHelp: (open: boolean) => void;
  fullscreen?: boolean;
  /** Toggles full screen; left out where the browser can't go full screen. */
  onFullscreen?: (() => void) | undefined;
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

type Mode = "wall" | "cross";

const OTHER: Record<Mode, Mode> = { wall: "cross", cross: "wall" };

const MODE_NAME: Record<Mode, string> = { wall: "wall-eyed", cross: "cross-eyed" };

const HOW_TO: Record<Mode, string> = {
  wall:
    "Bring your face close to the screen and look through it, as if at something far away. " +
    "Move back slowly, keeping your eyes relaxed, until the two dots become three and the " +
    "hidden shape appears.",
  cross:
    "Hold a fingertip between your eyes and the screen and focus on it, moving it until the " +
    "two dots behind it become three. Then let your gaze rest on the image.",
};

const DISTANCE: Record<Mode, string> = {
  wall:
    "Start with your nose almost touching the screen and move back very slowly. The shape " +
    "often appears 30 to 50 cm away.",
  cross:
    "Sit back, about an arm's length away. Crossing is easier from further back, and the " +
    "strips look narrower.",
};

const RELAX: Record<Mode, string> = {
  wall:
    "Don't try to focus on the pattern. Let your eyes go soft, blink, and give it a minute: " +
    "the shape often snaps into place all at once.",
  cross:
    "Cross only a little, just until the dots become three, then hold still and wait for the " +
    "shape to sharpen.",
};

type HowToProps = {
  mode: Mode;
  /** Estimated far-plane strip width, in millimetres. */
  stripMm: number;
  onClose: () => void;
  onSwitchMode: () => void;
  /** Shows the practice image; left out while it is showing. */
  onPractice: (() => void) | undefined;
};

function HowTo({ mode, stripMm, onClose, onSwitchMode, onPractice }: HowToProps) {
  const titleId = useId();
  return (
    <section class="viewer-help" aria-labelledby={titleId}>
      <h2 id={titleId}>How to view</h2>
      <p>This image is made for {MODE_NAME[mode]} viewing.</p>
      <p>{HOW_TO[mode]}</p>
      <details class="viewer-trouble">
        <summary>Can't see it?</summary>
        <ul>
          <li>
            <strong>Distance:</strong> {DISTANCE[mode]}
          </li>
          <li>
            <strong>Relax:</strong> {RELAX[mode]}
          </li>
          <li>
            <strong>Strip size:</strong> the strips here are about {Math.round(stripMm)} mm wide.
            Strips 20 to 40 mm wide are easiest, and wall-eyed viewing can't join strips wider than
            the gap between your eyes. The Phone and Monitor buttons resize them.
          </li>
          <li>
            <strong>Try {MODE_NAME[OTHER[mode]]}:</strong> some people find one way much easier than
            the other.
            <button type="button" class="button" onClick={onSwitchMode}>
              Switch to {MODE_NAME[OTHER[mode]]}
            </button>
          </li>
          {onPractice === undefined ? null : (
            <li>
              <strong>Practise:</strong> learn on an easy image with one bold shape and strong
              depth.
              <button type="button" class="button" onClick={onPractice}>
                Try a practice image
              </button>
            </li>
          )}
        </ul>
      </details>
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
export function Viewer({
  editor: scene,
  renderer,
  onExit,
  help,
  onHelp,
  fullscreen = false,
  onFullscreen,
}: Props) {
  const areaRef = useRef<HTMLDivElement>(null);
  const exitRef = useRef<HTMLButtonElement>(null);
  const helpRef = useRef<HTMLButtonElement>(null);
  const endPracticeRef = useRef<HTMLButtonElement>(null);
  const area = useSize(areaRef);
  const [context] = useState(viewingContext);
  const [peeking, setPeeking] = useState(false);
  /** The picture's size relative to fitting the screen. */
  const [zoom, setZoom] = useState(1);
  /** The practice image, shown instead of the scene without touching it. */
  const [practice, setPractice] = useState<Editor | undefined>(undefined);
  const editor = practice ?? scene;
  const { aspect, view } = editor.recipe.value;

  useEffect(() => {
    exitRef.current?.focus();
  }, []);

  // Closing the instructions from inside them leaves focus nowhere.
  useEffect(() => {
    const focused = document.activeElement;
    if (!help && (focused === null || focused === document.body)) {
      helpRef.current?.focus();
    }
  }, [help]);

  // Zooming, or the screen changing size, brings the middle of the picture to the middle.
  useLayoutEffect(() => {
    const element = areaRef.current;
    if (element !== null) {
      element.scrollLeft = (element.scrollWidth - element.clientWidth) / 2;
      element.scrollTop = (element.scrollHeight - element.clientHeight) / 2;
    }
  }, [zoom, area.width, area.height]);
  const zoomBy = (factor: number): void => {
    setZoom((old) => {
      const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, old * factor));
      // Steps back to fitting land on it exactly.
      return Math.abs(Math.log(next)) < 1e-9 ? 1 : next;
    });
  };

  const practising = practice !== undefined;
  const wasPractising = useRef(practising);
  useEffect(() => {
    if (practising !== wasPractising.current) {
      (practising ? endPracticeRef : helpRef).current?.focus();
    }
    wasPractising.current = practising;
  }, [practising]);

  const fit = Math.max(0, Math.min(area.width, (area.height - DOT_ROW) * aspect));
  const width = fit * zoom;
  const height = width / aspect;
  // The picture is shown in whole device pixels, a fraction narrower than its frame.
  const shown = previewDisplaySize(aspect, { width, height }, window.devicePixelRatio || 1);
  const strip = shown.width / view.repeats;
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
        {practising ? (
          <button
            ref={endPracticeRef}
            type="button"
            class="button"
            onClick={() => {
              setPractice(undefined);
            }}
          >
            End practice
          </button>
        ) : null}
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
        <div class="viewer-zoom" role="group" aria-label="Zoom">
          <button
            type="button"
            class="button"
            aria-label="Zoom out"
            title="Zoom out"
            disabled={zoom <= MIN_ZOOM}
            onClick={() => {
              zoomBy(1 / ZOOM_STEP);
            }}
          >
            −
          </button>
          <button
            type="button"
            class="button"
            aria-label="Zoom in"
            title="Zoom in"
            disabled={zoom >= MAX_ZOOM}
            onClick={() => {
              zoomBy(ZOOM_STEP);
            }}
          >
            +
          </button>
          <button
            type="button"
            class="button"
            aria-label="Size to fit"
            title="Size to fit"
            disabled={zoom === 1}
            onClick={() => {
              setZoom(1);
            }}
          >
            Fit
          </button>
        </div>
        {onFullscreen === undefined ? null : (
          <button type="button" class="button" aria-pressed={fullscreen} onClick={onFullscreen}>
            Full screen
          </button>
        )}
        <button
          ref={helpRef}
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
      <div class="viewer-stage">
        <div class="viewer-area" ref={areaRef} data-zoomed={zoom > 1}>
          <div class="viewer-picture" style={{ width: `${String(width)}px` }}>
            <div class="viewer-dots" aria-hidden="true">
              <span class="viewer-dot" style={{ left: `calc(50% - ${String(strip / 2)}px)` }} />
              <span class="viewer-dot" style={{ left: `calc(50% + ${String(strip / 2)}px)` }} />
            </div>
            <div class="viewer-frame" style={{ height: `${String(height)}px` }}>
              <Preview
                key={practising ? "practice" : "scene"}
                editor={editor}
                renderer={renderer}
                output={peeking ? "depth" : "stereogram"}
              />
            </div>
          </div>
        </div>
        {help ? (
          <HowTo
            mode={view.mode}
            stripMm={stripMm}
            onClose={() => {
              onHelp(false);
            }}
            onSwitchMode={() => {
              editor.setView({ mode: OTHER[view.mode] });
            }}
            onPractice={
              practising
                ? undefined
                : () => {
                    const repeats = width > 0 ? presetRepeats(context, width) : view.repeats;
                    setPractice(new Editor(practiceRecipe(view.mode, repeats)));
                    onHelp(false);
                  }
            }
          />
        ) : null}
      </div>
      <div class="viewer-guide">
        {practising ? (
          <p class="viewer-practice">Practice image: look for {PRACTICE_TARGET}.</p>
        ) : null}
        <p>
          {view.mode === "wall" ? "Relax" : "Cross"} your eyes until you see three dots.{" "}
          <span class="viewer-strip">Strips are about {Math.round(stripMm)} mm wide.</span>
        </p>
        <p class="viewer-advice" aria-live="polite">
          {advice}
        </p>
      </div>
    </div>
  );
}
