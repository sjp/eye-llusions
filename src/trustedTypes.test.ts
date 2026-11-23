import { describe, expect, test, vi } from "vitest";
import { createDefaultPolicy, sameOriginScriptUrl } from "./trustedTypes.ts";

const BASE = "https://example.org/app/";

describe("sameOriginScriptUrl", () => {
  test("passes same-origin addresses unchanged", () => {
    expect(sameOriginScriptUrl("https://example.org/app/assets/worker.js", BASE)).toBe(
      "https://example.org/app/assets/worker.js",
    );
    expect(sameOriginScriptUrl("./assets/worker.js", BASE)).toBe("./assets/worker.js");
  });

  test("refuses other origins and non-network schemes", () => {
    for (const url of [
      "https://evil.example/worker.js",
      "data:text/javascript,alert(1)",
      "blob:https://example.org/1234",
    ]) {
      expect(() => sameOriginScriptUrl(url, BASE)).toThrow("Refused to load a script");
    }
  });
});

describe("createDefaultPolicy", () => {
  test("creates a default policy for script addresses only", () => {
    const createPolicy =
      vi.fn<(name: string, rules: { createScriptURL: (url: string) => string }) => unknown>();
    createDefaultPolicy({ createPolicy }, BASE);
    expect(createPolicy).toHaveBeenCalledTimes(1);
    const [name, rules] = createPolicy.mock.calls[0];
    expect(name).toBe("default");
    expect(Object.keys(rules)).toEqual(["createScriptURL"]);
    expect(rules.createScriptURL("./worker.js")).toBe("./worker.js");
    expect(() => rules.createScriptURL("https://evil.example/worker.js")).toThrow("Refused");
  });

  test("does nothing without Trusted Types", () => {
    expect(() => {
      createDefaultPolicy(undefined, BASE);
    }).not.toThrow();
  });
});
