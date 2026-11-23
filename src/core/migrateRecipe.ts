import { RECIPE_VERSION } from "./recipe.ts";

type Fields = Record<string, unknown>;

/** Rewrites a recipe of one version into the shape of the next. */
export type Migration = (recipe: Fields) => Fields;

/**
 * Upgrade steps, keyed by the version each one upgrades from. A change to the recipe
 * format bumps RECIPE_VERSION and adds a step here, so older links and files still open.
 */
const MIGRATIONS: Readonly<Record<number, Migration>> = {};

function isFields(value: unknown): value is Fields {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Applies `steps` one version at a time until `input` reaches `target`. Anything that
 * isn't an older recipe with a path to `target` is returned unchanged, for parseRecipe
 * to accept or reject.
 */
export function applyMigrations(
  input: unknown,
  steps: Readonly<Record<number, Migration>>,
  target: number,
): unknown {
  try {
    if (!isFields(input)) {
      return input;
    }
    let current = input;
    for (let version = current.version; typeof version === "number"; version++) {
      if (!Number.isInteger(version) || version >= target || !Object.hasOwn(steps, version)) {
        break;
      }
      current = { ...steps[version](current), version: version + 1 };
    }
    return current;
  } catch {
    // Hostile objects (getters, proxies) can throw while being read; parseRecipe reports them.
    return input;
  }
}

/** Upgrades an untrusted recipe written by an older version to the current format. */
export function migrateRecipe(input: unknown): unknown {
  return applyMigrations(input, MIGRATIONS, RECIPE_VERSION);
}
