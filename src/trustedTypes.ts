/** The part of the Trusted Types API this module uses; TypeScript's DOM types lack it. */
type PolicyFactory = {
  createPolicy: (name: string, rules: { createScriptURL: (url: string) => string }) => unknown;
};

/**
 * Returns a script address unchanged when it's an ordinary address on the same origin as
 * `base`, and throws otherwise, also for blob: and data: addresses.
 */
export function sameOriginScriptUrl(url: string, base: string): string {
  const resolved = new URL(url, base);
  if (resolved.protocol !== new URL(base).protocol || resolved.origin !== new URL(base).origin) {
    throw new TypeError(`Refused to load a script from ${url}`);
  }
  return url;
}

function isPolicyFactory(value: unknown): value is PolicyFactory {
  return (
    typeof value === "object" &&
    value !== null &&
    "createPolicy" in value &&
    typeof value.createPolicy === "function"
  );
}

/**
 * Creates the default Trusted Types policy, which the CSP requires before a script
 * address, such as a worker's, reaches the DOM. It lets same-origin scripts through and has
 * no rules for HTML or script text, so those stay blocked. Does nothing in browsers
 * without Trusted Types.
 */
export function createDefaultPolicy(
  factory: unknown = Reflect.get(globalThis, "trustedTypes"),
  base = document.baseURI,
): void {
  if (isPolicyFactory(factory)) {
    factory.createPolicy("default", {
      createScriptURL: (url) => sameOriginScriptUrl(url, base),
    });
  }
}

createDefaultPolicy();
