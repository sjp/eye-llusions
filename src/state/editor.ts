import { batch, signal, type ReadonlySignal } from "@preact/signals";
import { pruneAssets } from "../core/assets.ts";
import { clampScale } from "../core/texture/scale.ts";
import { defaultRecipe, type Asset, type Layer, type Recipe } from "../core/recipe.ts";
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

  /** The texture scale follows the strip width into its fusible range. */
  setView(patch: Partial<View>, options: EditOptions = {}): void {
    this.#edit((recipe) => clampScale({ ...recipe, view: { ...recipe.view, ...patch } }), options);
  }

  /**
   * The scale is clamped into its fusible range for the generator and view. `assets` are
   * added, such as a tile's image, and assets nothing uses any more are dropped.
   */
  setTexture(
    patch: Partial<Texture>,
    options: EditOptions & { assets?: Record<string, Asset> } = {},
  ): void {
    this.#edit((recipe) => {
      const texture = { ...recipe.texture, ...patch };
      const assets =
        options.assets === undefined ? recipe.assets : { ...recipe.assets, ...options.assets };
      return pruneAssets(clampScale({ ...recipe, texture, assets }));
    }, options);
  }

  /**
   * Replaces the layer stack with `update`'s result; returning `layers` itself changes
   * nothing. `assets` are added with the new stack, and assets nothing uses any more are
   * dropped.
   */
  updateLayers(
    update: (layers: Layer[]) => Layer[],
    options: EditOptions & { assets?: Record<string, Asset> } = {},
  ): void {
    this.#edit((recipe) => {
      const layers = update(recipe.layers);
      if (layers === recipe.layers) {
        return recipe;
      }
      const assets =
        options.assets === undefined ? recipe.assets : { ...recipe.assets, ...options.assets };
      return pruneAssets({ ...recipe, layers, assets });
    }, options);
  }

  newSeed(): void {
    this.#edit((recipe) => ({ ...recipe, seed: this.#nextSeed() }), {});
  }

  /** Reshuffles the texture alone. */
  newTextureSeed(): void {
    this.setTexture({ seed: this.#nextSeed() });
  }

  /**
   * Replaces the whole recipe, such as with a shared scene, as one undo step. With
   * `fresh`, history starts over instead, so there is nothing to undo.
   */
  open(recipe: Recipe, { fresh = false }: { fresh?: boolean } = {}): void {
    this.#history.seal();
    if (fresh) {
      this.#history.reset(recipe);
    } else {
      this.#history.push(recipe);
      this.#history.seal();
    }
    this.#sync();
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
