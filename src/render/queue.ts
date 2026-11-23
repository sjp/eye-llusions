import type { RenderRequest, RenderResponse } from "./protocol.ts";

type Rendered = { image: ImageBitmap | ImageData; transfer: Transferable[] };

/** Turns a request into an image; any failure becomes an error reply. */
type RenderRequestHandler = (request: RenderRequest) => Promise<Rendered>;

export type Reply = (response: RenderResponse, transfer: Transferable[]) => void;

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Handles requests one at a time, in order, answering each one exactly once. A failure
 * at any step, sending the reply included, answers that request with an error and
 * leaves the queue ready for the next.
 */
export function createRenderQueue(
  render: RenderRequestHandler,
  reply: Reply,
): (request: RenderRequest) => Promise<void> {
  let queue = Promise.resolve();

  const handle = async (request: RenderRequest): Promise<void> => {
    const { requestId } = request;
    try {
      const { image, transfer } = await render(request);
      reply({ requestId, ok: true, image }, transfer);
    } catch (error) {
      try {
        reply({ requestId, ok: false, message: messageOf(error) }, []);
      } catch {
        // Keep the queue going for the requests after this one.
      }
    }
  };

  return (request) => {
    queue = queue.then(() => handle(request));
    return queue;
  };
}
