import type { Asset, Recipe } from "../core/recipe.ts";
import type { CancelRequest, RenderOutput, RenderRequest, RenderResponse } from "./protocol.ts";

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

/** Worker failures in a row, without a render in between, after which the client gives up. */
const MAX_FAILURES = 3;

/**
 * Renders recipes in one long-lived worker. The latest request wins: a newer call
 * rejects every unfinished one with `RenderAbortedError`. At most one request is with
 * the worker at a time and only the newest waiting call is sent after it, so a burst
 * of calls costs at most two renders; the worker is asked to cut the first one short.
 * A worker that fails is replaced on the next call,
 * until it has failed `MAX_FAILURES` times in a row.
 */
export class RenderClient {
  readonly #createWorker: () => Worker;
  #worker: Worker | undefined;
  #failures = 0;
  #lastError: Error | undefined;
  #disposed = false;
  #nextId = 1;
  #inFlight: InFlight | undefined;
  #queued: Job | undefined;
  /** Assets the worker holds, by ID, as the objects that were sent. */
  readonly #sent = new Map<string, Asset>();

  constructor(createWorker: () => Worker = createRenderWorker) {
    this.#createWorker = createWorker;
  }

  /** Calls whose promises haven't settled yet. */
  get pending(): number {
    return (this.#inFlight?.job === undefined ? 0 : 1) + (this.#queued === undefined ? 0 : 1);
  }

  render(recipe: Recipe, size: RenderSize, options: RenderOptions = {}): Promise<RenderImage> {
    this.#cancelInFlight();
    this.#abortPending();
    if (this.#disposed) {
      return Promise.reject(new Error("The renderer has been stopped"));
    }
    if (this.#failures >= MAX_FAILURES) {
      return Promise.reject(this.#lastError ?? new Error("The render worker failed"));
    }
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

  /** Stops the worker and rejects unfinished calls. Later calls reject at once. */
  dispose(): void {
    this.#abortPending();
    this.#disposed = true;
    this.#stopWorker();
  }

  #startWorker(): Worker {
    if (this.#worker !== undefined) {
      return this.#worker;
    }
    const worker = this.#createWorker();
    worker.addEventListener("message", (event: MessageEvent<RenderResponse>) => {
      if (worker === this.#worker) {
        this.#receive(event.data);
      }
    });
    worker.addEventListener("error", (event: Event) => {
      const detail = event instanceof ErrorEvent && event.message !== "" ? event.message : "";
      this.#fail(
        worker,
        new Error(`The render worker failed${detail === "" ? "" : `: ${detail}`}`),
      );
    });
    worker.addEventListener("messageerror", () => {
      this.#fail(worker, new Error("The render worker sent an unreadable reply"));
    });
    this.#worker = worker;
    return worker;
  }

  #stopWorker(): void {
    this.#worker?.terminate();
    this.#worker = undefined;
    this.#inFlight = undefined;
    this.#sent.clear();
  }

  /** Asks the worker to stop the render it's on, which this call is about to replace. */
  #cancelInFlight(): void {
    const inFlight = this.#inFlight;
    if (inFlight?.job !== undefined && this.#worker !== undefined) {
      const cancel: CancelRequest = { type: "cancel", requestId: inFlight.requestId };
      this.#worker.postMessage(cancel, []);
    }
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
    const worker = this.#startWorker();
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
      type: "render",
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
    worker.postMessage(request, []);
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
    this.#failures = 0;
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

  #fail(worker: Worker, error: Error): void {
    if (worker !== this.#worker) {
      return;
    }
    this.#failures++;
    this.#lastError = error;
    this.#inFlight?.job?.reject(error);
    this.#queued?.reject(error);
    this.#queued = undefined;
    this.#stopWorker();
  }
}
