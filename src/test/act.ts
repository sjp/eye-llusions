// oxlint-disable-next-line no-restricted-imports -- this wraps it
import { act as flush } from "@testing-library/preact";

/**
 * Testing Library's `act`, returning its promise only for an async callback. A sync
 * callback's updates are flushed before it returns, so there is nothing to await.
 */
export function act(callback: () => void): void;
export function act(callback: () => Promise<void>): Promise<void>;
export function act(callback: () => void | Promise<void>): void | Promise<void> {
  let returned: unknown;
  const done = flush(() => {
    returned = callback();
    return returned as Promise<void> | void;
  });
  return returned instanceof Promise ? done : undefined;
}
