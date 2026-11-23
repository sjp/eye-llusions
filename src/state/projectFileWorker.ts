import type { Recipe } from "../core/recipe.ts";
import { embedProject, ProjectFileError, readProject } from "./projectFile.ts";

export type ProjectRequest =
  | { type: "embed"; png: Uint8Array<ArrayBuffer>; recipe: Recipe }
  | { type: "read"; bytes: Uint8Array<ArrayBuffer> };

type ProjectResponse =
  | { ok: true; png: Uint8Array<ArrayBuffer> }
  | { ok: true; recipe: Recipe }
  | { ok: false; problem: ProjectFileError["kind"] | undefined };

/** Does a request's work, in the project worker or in its place. */
export async function handleProjectRequest(
  request: ProjectRequest,
): Promise<{ response: ProjectResponse; transfer: Transferable[] }> {
  try {
    if (request.type === "embed") {
      const png = await embedProject(request.png, request.recipe);
      return { response: { ok: true, png }, transfer: [png.buffer] };
    }
    return { response: { ok: true, recipe: await readProject(request.bytes) }, transfer: [] };
  } catch (error) {
    const problem = error instanceof ProjectFileError ? error.kind : undefined;
    return { response: { ok: false, problem }, transfer: [] };
  }
}

type Options = { signal?: AbortSignal; createWorker?: () => Worker | undefined };

function createProjectWorker(): Worker | undefined {
  return typeof Worker === "function"
    ? new Worker(new URL("./projectWorker.ts", import.meta.url), { type: "module" })
    : undefined;
}

/**
 * Runs a request in a worker of its own, so deflating and inflating large images doesn't
 * hold up the page, and stops the worker once it answers or `signal` aborts. The file
 * bytes in the request are handed over to the worker. Without worker support, the work
 * runs here instead.
 */
async function run(
  request: ProjectRequest,
  signal: AbortSignal | undefined,
  createWorker: () => Worker | undefined,
): Promise<ProjectResponse> {
  signal?.throwIfAborted();
  const worker = createWorker();
  if (worker === undefined) {
    return (await handleProjectRequest(request)).response;
  }
  try {
    return await new Promise<ProjectResponse>((resolve, reject) => {
      worker.addEventListener("message", (event: MessageEvent<ProjectResponse>) => {
        resolve(event.data);
      });
      worker.addEventListener("error", () => {
        reject(new Error("The project worker failed"));
      });
      signal?.addEventListener("abort", () => {
        reject(new DOMException("The operation was aborted.", "AbortError"));
      });
      const bytes = request.type === "embed" ? request.png : request.bytes;
      worker.postMessage(request, { transfer: [bytes.buffer] });
    });
  } finally {
    worker.terminate();
  }
}

function failure(response: { problem: ProjectFileError["kind"] | undefined }): Error {
  return response.problem === undefined
    ? new Error("The project file couldn't be processed")
    : new ProjectFileError(response.problem);
}

/** `embedProject`, run off the main thread. `png` is handed over and can't be used after. */
export async function embedProjectOffThread(
  png: Uint8Array<ArrayBuffer>,
  recipe: Recipe,
  { signal, createWorker = createProjectWorker }: Options = {},
): Promise<Uint8Array<ArrayBuffer>> {
  const response = await run({ type: "embed", png, recipe }, signal, createWorker);
  if (!response.ok) {
    throw failure(response);
  }
  if (!("png" in response)) {
    throw new Error("Unexpected response");
  }
  return response.png;
}

/**
 * `readProject`, run off the main thread, rejecting with ProjectFileError as it does.
 * `bytes` are handed over and can't be used after.
 */
export async function readProjectOffThread(
  bytes: Uint8Array<ArrayBuffer>,
  { signal, createWorker = createProjectWorker }: Options = {},
): Promise<Recipe> {
  const response = await run({ type: "read", bytes }, signal, createWorker);
  if (!response.ok) {
    throw failure(response);
  }
  if (!("recipe" in response)) {
    throw new Error("Unexpected response");
  }
  return response.recipe;
}
