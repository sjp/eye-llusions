import { describe, expect, test } from "vitest";
import { linkPreviewTags, siteUrl } from "./linkPreview.ts";

describe("siteUrl", () => {
  test("is undefined when unset or blank", () => {
    expect(siteUrl(undefined)).toBeUndefined();
    expect(siteUrl("  ")).toBeUndefined();
  });

  test("ends the path with a slash", () => {
    expect(siteUrl("https://example.org/eye-llusion")?.href).toBe(
      "https://example.org/eye-llusion/",
    );
    expect(siteUrl("https://example.org")?.href).toBe("https://example.org/");
  });

  test("rejects addresses that aren't plain web pages", () => {
    expect(() => siteUrl("eye-llusion")).toThrow("Invalid URL");
    expect(() => siteUrl("ftp://example.org/")).toThrow("http or https");
    expect(() => siteUrl("https://example.org/?a=1")).toThrow("query or fragment");
  });
});

describe("linkPreviewTags", () => {
  test("are left out without a site address", () => {
    expect(linkPreviewTags(undefined)).toEqual([]);
  });

  test("point at the preview picture with absolute addresses", () => {
    const tags = linkPreviewTags(siteUrl("https://example.org/eye-llusion"));
    const content = (property: string) =>
      tags.find((tag) => tag.attrs?.["property"] === property || tag.attrs?.["name"] === property)
        ?.attrs?.["content"];
    expect(tags).toContainEqual(
      expect.objectContaining({
        tag: "link",
        attrs: { rel: "canonical", href: "https://example.org/eye-llusion/" },
      }),
    );
    expect(content("og:url")).toBe("https://example.org/eye-llusion/");
    expect(content("og:image")).toBe("https://example.org/eye-llusion/preview.png");
    expect(content("og:image:width")).toBe("1200");
    expect(content("og:image:height")).toBe("630");
    expect(content("twitter:card")).toBe("summary_large_image");
  });
});
