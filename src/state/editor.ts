import { batch, signal, type ReadonlySignal } from "@preact/signals";
import { defaultRecipe, type Layer, type Recipe } from "../core/recipe.ts";
import { History } from "./history.ts";

type View = Recipe["view"];
type Texture = Recipe["texture"];

type EditOptions = {
  /**
   * Merges this edit with the previous ones that used the same key into one undo step,
   * until `endEdit` is called. Use it for continuous input such as a slider drag.
   */
  coalesce?: string;
};

function randomSeed(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0];
}

/**
 * The recipe being edited, with undo/redo. Every change goes through an action, so the
 * history sees it; the recipe signal is read-only to components.
 */
export class Editor {
  readonly #history: History<Recipe>;
  readonly #recipe;
  readonly #canUndo = signal(false);
  readonly #canRedo = signal(false);
  readonly #editing = signal(false);
  readonly #nextSeed: () => number;

  readonly recipe: ReadonlySignal<Recipe>;
  readonly canUndo: ReadonlySignal<boolean>;
  readonly canRedo: ReadonlySignal<boolean>;
  /** True while a coalesced edit, such as a slider drag, is under way. */
  readonly editing: ReadonlySignal<boolean>;

  constructor(initial: Recipe = defaultRecipe(), nextSeed: () => number = randomSeed) {
    this.#history = new History(initial);
    this.#recipe = signal(initial);
    this.#nextSeed = nextSeed;
    this.recipe = this.#recipe;
    this.canUndo = this.#canUndo;
    this.canRedo = this.#canRedo;
    this.editing = this.#editing;
  }

  setView(patch: Partial<View>, options: EditOptions = {}): void {
    this.#edit((recipe) => ({ ...recipe, view: { ...recipe.view, ...patch } }), options);
  }

  setTexture(patch: Partial<Texture>, options: EditOptions = {}): void {
    this.#edit((recipe) => ({ ...recipe, texture: { ...recipe.texture, ...patch } }), options);
  }

  /** Replaces the layer stack with `update`'s result. */
  updateLayers(update: (layers: Layer[]) => Layer[], options: EditOptions = {}): void {
    this.#edit((recipe) => ({ ...recipe, layers: update(recipe.layers) }), options);
  }

  newSeed(): void {
    this.#edit((recipe) => ({ ...recipe, seed: this.#nextSeed() }), {});
  }

  /** Ends a coalesced edit, so the next change starts a new undo step. */
  endEdit(): void {
    this.#history.seal();
    this.#sync();
  }

  undo(): void {
    this.#history.undo();
    this.#sync();
  }

  redo(): void {
    this.#history.redo();
    this.#sync();
  }

  #edit(change: (recipe: Recipe) => Recipe, options: EditOptions): void {
    this.#history.push(change(this.#history.present), options.coalesce);
    this.#sync();
  }

  #sync(): void {
    batch(() => {
      this.#recipe.value = this.#history.present;
      this.#canUndo.value = this.#history.canUndo;
      this.#canRedo.value = this.#history.canRedo;
      this.#editing.value = this.#history.coalescing;
    });
  }
}
