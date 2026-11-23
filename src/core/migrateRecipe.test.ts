import { describe, expect, test } from "vitest";
import { applyMigrations, migrateRecipe, type Migration } from "./migrateRecipe.ts";
import { parseRecipe } from "./parseRecipe.ts";
import { defaultRecipe } from "./recipe.ts";

describe("migrateRecipe", () => {
  test("leave a current recipe as it is", () => {
    const recipe: unknown = structuredClone(defaultRecipe());
    expect(migrateRecipe(recipe)).toBe(recipe);
    expect(parseRecipe(migrateRecipe(recipe))).toEqual(defaultRecipe());
  });

  test.each([null, 7, "recipe", [], {}, { version: "1" }, { version: 99 }, { version: 0 }])(
    "pass %j through for parseRecipe to judge",
    (input) => {
      expect(migrateRecipe(input)).toBe(input);
    },
  );
});

describe("applyMigrations", () => {
  // Version 1 named the seed `salt`; version 2 split `size` into width and height.
  const steps: Record<number, Migration> = {
    1: ({ salt, ...rest }) => ({ ...rest, seed: salt }),
    2: ({ size, ...rest }) => ({ ...rest, width: size, height: size }),
  };

  test("upgrade one version at a time", () => {
    const input = { version: 1, salt: 5, size: 2 };
    expect(applyMigrations(input, steps, 3)).toEqual({ version: 3, seed: 5, width: 2, height: 2 });
    expect(applyMigrations({ version: 2, seed: 5, size: 2 }, steps, 3)).toEqual({
      version: 3,
      seed: 5,
      width: 2,
      height: 2,
    });
    expect(input).toEqual({ version: 1, salt: 5, size: 2 });
  });

  test("stop at the target version", () => {
    expect(applyMigrations({ version: 1, salt: 5 }, steps, 2)).toEqual({ version: 2, seed: 5 });
    const current = { version: 3, seed: 5 };
    expect(applyMigrations(current, steps, 3)).toBe(current);
  });

  test("leave versions with no path to the target unchanged", () => {
    for (const input of [{ version: 0 }, { version: 1.5 }, { version: 4 }, { version: "1" }]) {
      expect(applyMigrations(input, steps, 3)).toBe(input);
    }
  });

  test("return hostile input unchanged", () => {
    const hostile = {
      get version(): number {
        throw new Error("boom");
      },
    };
    expect(applyMigrations(hostile, steps, 3)).toBe(hostile);
  });
});
