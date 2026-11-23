/** Most undo steps kept; the oldest are dropped first. */
const HISTORY_LIMIT = 100;

type HistoryOptions<T> = {
  /** Most undo steps kept. */
  limit?: number;
  /**
   * The memory a value holds, as pieces that values may share: each piece's identity
   * and size in bytes. Pieces held by several values count once.
   */
  sizeOf?: (value: T) => Iterable<readonly [piece: unknown, bytes: number]>;
  /** Bytes the kept values may hold between them before the oldest steps are dropped. */
  budget?: number;
};

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
  readonly #sizeOf: HistoryOptions<T>["sizeOf"];
  readonly #budget: number;

  /**
   * With `sizeOf`, the oldest undo steps are also dropped once the past and present hold
   * more than `budget` bytes between them. The present is always kept.
   */
  constructor(
    initial: T,
    { limit = HISTORY_LIMIT, sizeOf, budget = Infinity }: HistoryOptions<T> = {},
  ) {
    this.#present = initial;
    this.#limit = limit;
    this.#sizeOf = sizeOf;
    this.#budget = budget;
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
    this.#keepWithinBudget();
  }

  #keepWithinBudget(): void {
    const sizeOf = this.#sizeOf;
    if (sizeOf === undefined) {
      return;
    }
    // Newest first, so the steps that fit are the ones kept.
    const counted = new Set<unknown>();
    let total = 0;
    const add = (value: T): void => {
      for (const [piece, bytes] of sizeOf(value)) {
        if (!counted.has(piece)) {
          counted.add(piece);
          total += bytes;
        }
      }
    };
    add(this.#present);
    for (let i = this.#past.length - 1; i >= 0; i--) {
      add(this.#past[i]);
      if (total > this.#budget) {
        this.#past.splice(0, i + 1);
        return;
      }
    }
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
