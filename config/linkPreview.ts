import type { HtmlTagDescriptor, Plugin } from "vite";

/** The preview picture in public/, as drawn by scripts/generate-site-images.ts. */
const PREVIEW = { path: "preview.png", width: 1200, height: 630 };
const PREVIEW_ALT = "A colourful magic-eye picture of a rocket lifting off";

/**
 * The site's address with a trailing slash, from a `SITE_URL` such as
 * `https://example.github.io/eye-llusion`, or undefined when it's unset or blank.
 */
export function siteUrl(value: string | undefined): URL | undefined {
  if (value === undefined || value.trim() === "") {
    return undefined;
  }
  const url = new URL(value.trim());
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error(`SITE_URL must be an http or https address, not ${value}`);
  }
  if (url.search !== "" || url.hash !== "") {
    throw new Error(`SITE_URL must not have a query or fragment: ${value}`);
  }
  if (!url.pathname.endsWith("/")) {
    url.pathname += "/";
  }
  return url;
}

/**
 * Tags that need the site's absolute address: link previews only show an image given
 * an absolute URL, which the relative build base can't provide.
 */
export function linkPreviewTags(site: URL | undefined): HtmlTagDescriptor[] {
  if (site === undefined) {
    return [];
  }
  const image = new URL(PREVIEW.path, site).href;
  const meta = (key: "name" | "property", name: string, content: string): HtmlTagDescriptor => ({
    tag: "meta",
    attrs: { [key]: name, content },
    injectTo: "head",
  });
  return [
    { tag: "link", attrs: { rel: "canonical", href: site.href }, injectTo: "head" },
    meta("property", "og:url", site.href),
    meta("property", "og:image", image),
    meta("property", "og:image:type", "image/png"),
    meta("property", "og:image:width", String(PREVIEW.width)),
    meta("property", "og:image:height", String(PREVIEW.height)),
    meta("property", "og:image:alt", PREVIEW_ALT),
    meta("name", "twitter:card", "summary_large_image"),
  ];
}

/** Adds the link preview tags to the built page when `SITE_URL` is set. */
export function linkPreview(value = process.env["SITE_URL"]): Plugin {
  const site = siteUrl(value);
  return {
    name: "link-preview",
    apply: "build",
    transformIndexHtml: () => linkPreviewTags(site),
  };
}
