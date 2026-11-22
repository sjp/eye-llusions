import { expect, test } from "vitest";
import { uncoveredCharacters } from "./fonts.ts";

test("Latin text, accents and common punctuation are covered", () => {
  expect(uncoveredCharacters("Hello, Ŵörld! “Quoted” – €5\nŒuvre ẞ")).toEqual([]);
});

test("lists each character outside the bundled fonts once", () => {
  expect(uncoveredCharacters("Γειά 你好 你 🙂")).toEqual(["Γ", "ε", "ι", "ά", "你", "好", "🙂"]);
});
