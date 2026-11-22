import type { Asset, Recipe } from "../core/recipe.ts";
import type { RenderOutput, RenderRequest, RenderResponse } from "./protocol.ts";

/** Rejects a render that a newer request replaced before it finished. */
class RenderAbortedError extends Error {
  constructor() {
    super("Superseded by a newer render");
    this.name = "RenderAbortedError";
  }
}

export function isRenderAborted(error: unknown): error is RenderAbortedError {
  return error instanceof RenderAbortedError;
}

export type RenderImage = ImageBitmap | ImageData;

type RenderSize = { width: number; height: number };

type RenderOptions = {
  /** Horizontal supersampling for the stereogram; 1 by default. */
  oversample?: number;
  output?: RenderOutput;
};

type Job = {
  recipe: Recipe;
  size: RenderSize;
  oversample: number;
  output: RenderOutput;
  resolve: (image: RenderImage) => void;
  reject: (error: Error) => void;
};

type InFlight = { requestId: number; job: Job | undefined };

function release(image: RenderImage): void {
  if (!(image instanceof ImageData)) {
    image.close();
  }
}

function createRenderWorker(): Worker {
  return new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
}

/**
 * Renders recipes in one long-lived worker. The latest request wins: a newer call
 * rejects every unfinished one with `RenderAbortedError`. At most one request is with
 * the worker at a time and only the newest waiting call is sent after it, so a burst
 * of calls costs at most two renders.
 */
export class RenderClient {
  readonly #worker: Worker;
  #nextId = 1;
  #inFlight: InFlight | undefined;
  #queued: Job | undefined;
  /** Assets the worker holds, by ID, as the objects that were sent. */
  readonly #sent = new Map<string, Asset>();

  constructor(worker: Worker = createRenderWorker()) {
    this.#worker = worker;
    worker.addEventListener("message", (event: MessageEvent<RenderResponse>) => {
      this.#receive(event.data);
    });
    worker.addEventListener("error", () => {
      this.#fail(new Error("The render worker failed"));
    });
    worker.addEventListener("messageerror", () => {
      this.#fail(new Error("The render worker sent an unreadable reply"));
    });
  }

  /** Calls whose promises haven't settled yet. */
  get pending(): number {
    return (this.#inFlight?.job === undefined ? 0 : 1) + (this.#queued === undefined ? 0 : 1);
  }

  render(recipe: Recipe, size: RenderSize, options: RenderOptions = {}): Promise<RenderImage> {
    this.#abortPending();
    return new Promise((resolve, reject) => {
      const job: Job = {
        recipe,
        size: { width: size.width, height: size.height },
        oversample: options.oversample ?? 1,
        output: options.output ?? "stereogram",
        resolve,
        reject,
      };
      if (this.#inFlight === undefined) {
        this.#send(job);
      } else {
        this.#queued = job;
      }
    });
  }

  /** Stops the worker and rejects unfinished calls. The client can't render afterwards. */
  dispose(): void {
    this.#abortPending();
    this.#inFlight = undefined;
    this.#worker.terminate();
  }

  #abortPending(): void {
    this.#queued?.reject(new RenderAbortedError());
    this.#queued = undefined;
    if (this.#inFlight !== undefined) {
      this.#inFlight.job?.reject(new RenderAbortedError());
      this.#inFlight.job = undefined;
    }
  }

  #send(job: Job): void {
    const assetIds = Object.keys(job.recipe.assets);
    const assets: Record<string, Asset> = {};
    for (const id of assetIds) {
      const asset = job.recipe.assets[id];
      if (this.#sent.get(id) !== asset) {
        assets[id] = asset;
        this.#sent.set(id, asset);
      }
    }
    const kept = new Set(assetIds);
    for (const id of this.#sent.keys()) {
      if (!kept.has(id)) {
        this.#sent.delete(id);
      }
    }
    const requestId = this.#nextId++;
    const request: RenderRequest = {
      requestId,
      recipe: { ...job.recipe, assets: {} },
      width: job.size.width,
      height: job.size.height,
      oversample: job.oversample,
      output: job.output,
      assets,
      assetIds,
    };
    this.#inFlight = { requestId, job };
    this.#worker.postMessage(request, []);
  }

  #receive(response: RenderResponse): void {
    const inFlight = this.#inFlight;
    if (inFlight?.requestId !== response.requestId) {
      if (response.ok) {
        release(response.image);
      }
      return;
    }
    this.#inFlight = undefined;
    const { job } = inFlight;
    if (response.ok) {
      if (job === undefined) {
        release(response.image);
      } else {
        job.resolve(response.image);
      }
    } else {
      job?.reject(new Error(response.message));
    }
    const next = this.#queued;
    this.#queued = undefined;
    if (next !== undefined) {
      this.#send(next);
    }
  }

  #fail(error: Error): void {
    this.#inFlight?.job?.reject(error);
    this.#queued?.reject(error);
    this.#inFlight = undefined;
    this.#queued = undefined;
    this.#sent.clear();
  }
}
