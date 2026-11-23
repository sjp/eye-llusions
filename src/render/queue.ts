import type { RenderRequest, RenderResponse, WorkerMessage } from "./protocol.ts";

type Rendered = { image: ImageBitmap | ImageData; transfer: Transferable[] };

/**
 * Turns a request into an image, awaiting `pause` now and then; `pause` throws once the
 * request is cancelled. Any failure becomes an error reply.
 */
type RenderRequestHandler = (
  request: RenderRequest,
  pause: () => Promise<void>,
) => Promise<Rendered>;

export type Reply = (response: RenderResponse, transfer: Transferable[]) => void;

type QueueOptions = {
  /** How long to work, in milliseconds, before a pause yields to waiting messages. */
  sliceMs?: number;
  now?: () => number;
  /** Resolves once messages that were already waiting have been handled. */
  yieldTask?: () => Promise<void>;
};

class RenderCancelledError extends Error {
  constructor() {
    super("Cancelled");
    this.name = "RenderCancelledError";
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

let channel: MessageChannel | undefined;
const waiting: (() => void)[] = [];

/**
 * Resolves in a task queued behind any messages already waiting, through a message
 * channel: repeated zero-delay timeouts are throttled to 4 ms each.
 */
function yieldToMessages(): Promise<void> {
  if (typeof MessageChannel !== "function") {
    return new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
  }
  if (channel === undefined) {
    channel = new MessageChannel();
    channel.port1.addEventListener("message", () => {
      waiting.shift()?.();
    });
    channel.port1.start();
  }
  const port = channel.port2;
  return new Promise((resolve) => {
    waiting.push(resolve);
    port.postMessage(null);
  });
}

/**
 * Handles requests one at a time, in order, answering each one exactly once. A failure
 * at any step, sending the reply included, answers that request with an error and
 * leaves the queue ready for the next. A request is dropped at its next pause once it
 * has been cancelled or a newer request has arrived.
 */
export function createRenderQueue(
  render: RenderRequestHandler,
  reply: Reply,
  { sliceMs = 10, now = () => performance.now(), yieldTask = yieldToMessages }: QueueOptions = {},
): (message: WorkerMessage) => Promise<void> {
  let queue = Promise.resolve();
  /** Requests with this ID or lower are no longer wanted. */
  let staleThrough = 0;
  let lastYield = now();

  const handle = async (request: RenderRequest): Promise<void> => {
    const { requestId } = request;
    const pause = async (): Promise<void> => {
      if (now() - lastYield >= sliceMs) {
        await yieldTask();
        lastYield = now();
      }
      if (requestId <= staleThrough) {
        throw new RenderCancelledError();
      }
    };
    try {
      const { image, transfer } = await render(request, pause);
      reply({ requestId, ok: true, image }, transfer);
    } catch (error) {
      try {
        reply({ requestId, ok: false, message: messageOf(error) }, []);
      } catch {
        // Keep the queue going for the requests after this one.
      }
    }
  };

  return (message) => {
    if (message.type === "cancel") {
      staleThrough = Math.max(staleThrough, message.requestId);
      return queue;
    }
    staleThrough = Math.max(staleThrough, message.requestId - 1);
    queue = queue.then(() => handle(message));
    return queue;
  };
}
