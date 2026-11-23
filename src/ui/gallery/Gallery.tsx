import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import type { Recipe } from "../../core/recipe.ts";
import { isRenderAborted, type RenderImage } from "../../render/client.ts";
import type { Renderer } from "../Preview.tsx";
import { useRenderer } from "../useRenderer.ts";
import { GALLERY, type GallerySample } from "./samples.ts";

/** Width of the rendered thumbnails, in pixels. */
const THUMBNAIL_WIDTH = 384;

/** Thumbnails already rendered, kept for the session so the gallery reopens at once. */
const thumbnails = new Map<string, RenderImage>();

function thumbnailSize(recipe: Recipe) {
  return { width: THUMBNAIL_WIDTH, height: Math.round(THUMBNAIL_WIDTH / recipe.aspect) };
}

/** What to focus on opening the gallery: its heading, or a sample's View button. */
export type GalleryFocus = "heading" | { sample: string };

type Props = {
  /** Renders the thumbnails; defaults to a render worker of the gallery's own. */
  renderer?: Renderer | undefined;
  focus?: GalleryFocus | undefined;
  onView: (sample: GallerySample) => void;
  onRemix: (sample: GallerySample) => void;
  onBlank: () => void;
};

/**
 * Renders the thumbnails of cards near the viewport one at a time, in gallery order, so
 * a render never replaces another one still running.
 */
function useThumbnails(renderer: Renderer, list: { current: HTMLElement | null }) {
  const [near, setNear] = useState<ReadonlySet<string>>(() =>
    typeof IntersectionObserver === "function"
      ? new Set()
      : new Set(GALLERY.map((sample) => sample.id)),
  );
  const [failed, setFailed] = useState<ReadonlySet<string>>(new Set());
  const [pending, setPending] = useState<string | undefined>(undefined);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    const element = list.current;
    if (typeof IntersectionObserver !== "function" || element === null) {
      return undefined;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        const ids = entries.flatMap((entry) =>
          entry.isIntersecting && entry.target instanceof HTMLElement
            ? [entry.target.dataset["id"] ?? ""]
            : [],
        );
        if (ids.length > 0) {
          setNear((old) => new Set([...old, ...ids]));
        }
      },
      { rootMargin: "200px" },
    );
    for (const card of element.querySelectorAll("[data-id]")) {
      observer.observe(card);
    }
    return () => {
      observer.disconnect();
    };
  }, [list]);

  useEffect(() => {
    if (pending !== undefined) {
      return;
    }
    const next = GALLERY.find(({ id }) => near.has(id) && !thumbnails.has(id) && !failed.has(id));
    if (next === undefined) {
      return;
    }
    setPending(next.id);
    const render = async (): Promise<void> => {
      try {
        thumbnails.set(next.id, await renderer.render(next.recipe, thumbnailSize(next.recipe)));
      } catch (error) {
        if (!mounted.current || isRenderAborted(error)) {
          return;
        }
        setFailed((old) => new Set([...old, next.id]));
      }
      if (mounted.current) {
        setPending(undefined);
      }
    };
    void render();
  }, [renderer, near, failed, pending]);

  return failed;
}

function Thumbnail({ sample, failed }: { sample: GallerySample; failed: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const image = thumbnails.get(sample.id);
  const { width, height } = thumbnailSize(sample.recipe);
  // Drawn as the canvas is marked ready, so it never shows as ready but empty.
  useLayoutEffect(() => {
    const context = ref.current?.getContext("2d");
    if (image === undefined || context === null || context === undefined) {
      return;
    }
    if (image instanceof ImageData) {
      context.putImageData(image, 0, 0);
    } else {
      context.drawImage(image, 0, 0);
    }
  }, [image]);
  return (
    <div class="gallery-thumbnail">
      <canvas
        ref={ref}
        width={width}
        height={height}
        role="img"
        aria-label={`${sample.title} stereogram`}
        data-ready={image !== undefined}
      />
      {failed && <p class="panel-note error">The preview couldn't be drawn.</p>}
    </div>
  );
}

/** The first screen: ready-made scenes to view or remix, or a blank start. */
export function Gallery({ renderer: given, focus, onView, onRemix, onBlank }: Props) {
  const renderer = useRenderer(given);
  const list = useRef<HTMLUListElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const failed = useThumbnails(renderer, list);
  // Only on opening the gallery.
  const [opening] = useState(focus);

  useEffect(() => {
    if (opening === "heading") {
      heading.current?.focus();
    } else if (opening !== undefined) {
      list.current
        ?.querySelector<HTMLElement>(`[data-id="${opening.sample}"] .gallery-view`)
        ?.focus();
    }
  }, [opening]);

  return (
    <main class="gallery">
      <header class="gallery-header">
        <h1 ref={heading} tabIndex={-1}>
          Eye-llusion
        </h1>
        <p>
          Magic-eye pictures that hide a 3D scene in a pattern. View one to try your eyes, or remix
          it into a picture of your own.
        </p>
        <button type="button" class="button" onClick={onBlank}>
          Start from blank
        </button>
      </header>
      <ul ref={list} class="gallery-grid" aria-label="Samples">
        {GALLERY.map((sample) => (
          <li key={sample.id} class="gallery-card" data-id={sample.id}>
            <Thumbnail sample={sample} failed={failed.has(sample.id)} />
            <div class="gallery-card-footer">
              <h2>{sample.title}</h2>
              <button
                type="button"
                class="button gallery-view"
                aria-label={`View ${sample.title}`}
                onClick={() => {
                  onView(sample);
                }}
              >
                View
              </button>
              <button
                type="button"
                class="button"
                aria-label={`Remix ${sample.title}`}
                onClick={() => {
                  onRemix(sample);
                }}
              >
                Remix
              </button>
            </div>
          </li>
        ))}
      </ul>
    </main>
  );
}
