import { effect } from "@preact/signals";
import type { ComponentChildren } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { Recipe } from "../core/recipe.ts";
import { isRenderAborted, type RenderClient, type RenderImage } from "../render/client.ts";
import type { RenderOutput } from "../render/protocol.ts";
import { createPreviewScheduler, previewDisplaySize, previewSize } from "../render/resolution.ts";
import type { Editor } from "../state/editor.ts";

export type Renderer = Pick<RenderClient, "render">;

type Quality = "draft" | "full";

type Box = { width: number; height: number; pixelRatio: number };

type Props = {
  editor: Editor;
  renderer: Renderer;
  output: RenderOutput;
  /** A CSS transform for zooming and panning the picture. */
  transform?: string | undefined;
  /** Called with the recipe of each image as it is shown. */
  onShown?: (recipe: Recipe) => void;
  /** Laid over the picture, at its size, and transformed with it. */
  children?: ComponentChildren;
};

function draw(canvas: HTMLCanvasElement, image: RenderImage): void {
  canvas.width = image.width;
  canvas.height = image.height;
  const context = canvas.getContext("2d");
  if (image instanceof ImageData) {
    context?.putImageData(image, 0, 0);
  } else {
    context?.drawImage(image, 0, 0);
    image.close();
  }
}

/**
 * The recipe rendered to fit its container at the device pixel ratio: drafts while an
 * edit such as a slider drag is under way, then a full render once it settles.
 */
export function Preview({ editor, renderer, output, transform, onShown, children }: Props) {
  const boxRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [box, setBox] = useState<Box | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const latest = useRef({ box, output, onShown });
  latest.current = { box, output, onShown };

  useEffect(() => {
    const element = boxRef.current;
    if (element === null) {
      return undefined;
    }
    const measure = (): void => {
      const { width, height } = element.getBoundingClientRect();
      const pixelRatio = window.devicePixelRatio || 1;
      setBox((old) =>
        old?.width === width && old.height === height && old.pixelRatio === pixelRatio
          ? old
          : { width, height, pixelRatio },
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);

  const scheduler = useMemo(() => {
    let renders = 0;
    let active = true;
    const show = async (
      pending: Promise<RenderImage>,
      recipe: Recipe,
      current: Box,
      wanted: RenderOutput,
      quality: Quality,
    ): Promise<void> => {
      let image: RenderImage;
      try {
        image = await pending;
      } catch (reason) {
        if (active && !isRenderAborted(reason)) {
          setError(reason instanceof Error ? reason.message : String(reason));
        }
        return;
      }
      const canvas = canvasRef.current;
      if (!active || canvas === null) {
        if (!(image instanceof ImageData)) {
          image.close();
        }
        return;
      }
      draw(canvas, image);
      const shown = previewDisplaySize(recipe.aspect, current, current.pixelRatio);
      canvas.style.width = `${String(shown.width)}px`;
      canvas.style.height = `${String(shown.height)}px`;
      renders++;
      canvas.dataset["output"] = wanted;
      canvas.dataset["quality"] = quality;
      canvas.dataset["renders"] = String(renders);
      setError(undefined);
      latest.current.onShown?.(recipe);
    };

    // One preview render at a time, so each finishes and shows even during a fast drag;
    // requests made meanwhile collapse into the newest.
    let busy = false;
    let queued: Quality | undefined;
    const request = (quality: Quality): void => {
      if (busy) {
        queued = quality;
        return;
      }
      const { box: current, output: wanted } = latest.current;
      if (!active || current === undefined || current.width <= 0 || current.height <= 0) {
        return;
      }
      const recipe = editor.recipe.peek();
      const size = previewSize(recipe.aspect, current, current.pixelRatio, quality);
      busy = true;
      void drain(
        show(renderer.render(recipe, size, { output: wanted }), recipe, current, wanted, quality),
      );
    };
    const drain = async (job: Promise<void>): Promise<void> => {
      await job;
      busy = false;
      const next = queued;
      queued = undefined;
      if (next !== undefined) {
        request(next);
      }
    };
    const scheduled = createPreviewScheduler(request);
    return {
      ...scheduled,
      stop: () => {
        active = false;
        scheduled.cancel();
      },
    };
  }, [editor, renderer]);

  useEffect(() => scheduler.stop, [scheduler]);

  useEffect(() => {
    scheduler.flush();
  }, [scheduler, box, output]);

  useEffect(() => {
    let previous = editor.recipe.peek();
    return effect(() => {
      const recipe = editor.recipe.value;
      if (recipe === previous) {
        return;
      }
      previous = recipe;
      if (editor.editing.peek()) {
        scheduler.change();
      } else {
        scheduler.flush();
      }
    });
  }, [editor, scheduler]);

  return (
    <div class="preview" ref={boxRef}>
      <div class="preview-surface" style={transform === undefined ? undefined : { transform }}>
        <canvas
          ref={canvasRef}
          class="preview-canvas"
          role="img"
          aria-label={output === "depth" ? "Depth map preview" : "Stereogram preview"}
        />
        {children}
      </div>
      {error === undefined ? null : (
        <p class="preview-error" role="alert">
          The preview couldn't be rendered: {error}
        </p>
      )}
    </div>
  );
}
