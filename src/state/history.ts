/** Most undo steps kept; the oldest are dropped first. */
const HISTORY_LIMIT = 100;

/**
 * Undo/redo history of immutable snapshots. A run of `push` calls with the same
 * `coalesce` key, such as the steps of one slider drag, makes a single undo step until
 * `seal` ends the run.
 */
export class History<T> {
  #present: T;
  readonly #past: T[] = [];
  #future: T[] = [];
  #openKey: string | undefined;
  readonly #limit: number;

  constructor(initial: T, limit = HISTORY_LIMIT) {
    this.#present = initial;
    this.#limit = limit;
  }

  get present(): T {
    return this.#present;
  }

  get canUndo(): boolean {
    return this.#past.length > 0;
  }

  get canRedo(): boolean {
    return this.#future.length > 0;
  }

  /** Whether a coalescing run is open. */
  get coalescing(): boolean {
    return this.#openKey !== undefined;
  }

  push(value: T, coalesce?: string): void {
    if (value === this.#present) {
      return;
    }
    if (coalesce === undefined || coalesce !== this.#openKey) {
      this.#past.push(this.#present);
      if (this.#past.length > this.#limit) {
        this.#past.shift();
      }
    }
    this.#openKey = coalesce;
    this.#present = value;
    this.#future = [];
  }

  /** Starts over from `value`, with nothing to undo or redo. */
  reset(value: T): void {
    this.#present = value;
    this.#past.length = 0;
    this.#future = [];
    this.#openKey = undefined;
  }

  seal(): void {
    this.#openKey = undefined;
  }

  undo(): boolean {
    this.seal();
    const previous = this.#past.pop();
    if (previous === undefined) {
      return false;
    }
    this.#future.push(this.#present);
    this.#present = previous;
    return true;
  }

  redo(): boolean {
    this.seal();
    const next = this.#future.pop();
    if (next === undefined) {
      return false;
    }
    this.#past.push(this.#present);
    this.#present = next;
    return true;
  }
}
