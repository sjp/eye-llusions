import { expect, test } from "vitest";
import { loadFont } from "./fonts.ts";

test("rejects fonts that aren't bundled", async () => {
  await expect(loadFont("comic-sans")).rejects.toThrow('there is no font called "comic-sans"');
});
