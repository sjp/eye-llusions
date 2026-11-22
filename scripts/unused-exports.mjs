// Reports exported symbols in src/ that no other module imports, and exits non-zero
// if there are any. It is a regex scan, not a parser: it understands the import and
// export forms this codebase uses, and treats `import * as`, `export * from` and
// dynamic or URL imports of a module as using all of its exports.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "src");
const EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs"];

/**
 * @param {string} dir
 * @returns {string[]}
 */
function listSourceFiles(dir) {
  /** @type {string[]} */
  const files = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      files.push(...listSourceFiles(path));
    } else if (EXTENSIONS.some((ext) => name.endsWith(ext)) && !name.endsWith(".d.ts")) {
      files.push(path);
    }
  }
  return files;
}

/**
 * Removes comments so commented-out imports and exports don't count.
 * @param {string} source
 */
function stripComments(source) {
  return source.replaceAll(/\/\*[\s\S]*?\*\//g, "").replaceAll(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
}

/**
 * Resolves a relative specifier to a file in src/, or undefined for packages and
 * anything that can't be found.
 * @param {string} from
 * @param {string} specifier
 */
function resolveSpecifier(from, specifier) {
  if (!specifier.startsWith(".")) {
    return undefined;
  }
  const base = resolve(dirname(from), specifier.replace(/\?.*$/, ""));
  const candidates = [
    base,
    ...EXTENSIONS.map((ext) => base + ext),
    ...EXTENSIONS.map((ext) => join(base, `index${ext}`)),
  ];
  return candidates.find((path) => existsSync(path) && statSync(path).isFile());
}

/**
 * Names in a `{ a, b as c, type d }` clause, as [imported or local name, exported name].
 * @param {string} clause
 * @returns {[string, string][]}
 */
function parseNamedClause(clause) {
  return clause
    .split(",")
    .map((part) => part.trim().replace(/^type\s+/, ""))
    .filter((part) => part !== "")
    .map((part) => {
      const words = part.split(/\s+as\s+/);
      const left = words.at(0) ?? "";
      return [left.trim(), (words.at(-1) ?? left).trim()];
    });
}

/**
 * A capture group that may not have participated in the match.
 * @param {RegExpMatchArray} match
 * @param {number} index
 * @returns {string | undefined}
 */
function optionalGroup(match, index) {
  return match[index];
}

const files = listSourceFiles(SRC);

/** @type {Map<string, Set<string>>} exported names per file */
const exported = new Map();
/** @type {Map<string, Set<string>>} names imported from each file by others */
const used = new Map();
/** @type {Set<string>} files whose every export counts as used */
const fullyUsed = new Set();

/**
 * @param {string} file
 * @param {string} name
 */
function markUsed(file, name) {
  let names = used.get(file);
  if (names === undefined) {
    names = new Set();
    used.set(file, names);
  }
  names.add(name);
}

for (const file of files) {
  const source = stripComments(readFileSync(file, "utf8"));
  /** @type {Set<string>} */
  const names = new Set();
  exported.set(file, names);

  for (const match of source.matchAll(
    /\bexport\s+(?:declare\s+)?(?:async\s+)?(?:abstract\s+)?(?:const|let|var|function\*?|class|type|interface|enum|namespace)\s+([A-Za-z_$][\w$]*)/g,
  )) {
    names.add(match[1]);
  }
  if (/\bexport\s+default\b/.test(source)) {
    names.add("default");
  }

  // `export { a, b as c }` with or without `from`.
  for (const match of source.matchAll(
    /\bexport\s+(?:type\s+)?\{([^}]*)\}(?:\s*from\s*["']([^"']+)["'])?/g,
  )) {
    const specifier = optionalGroup(match, 2);
    const target = specifier === undefined ? undefined : resolveSpecifier(file, specifier);
    for (const [local, name] of parseNamedClause(match[1])) {
      names.add(name);
      if (target !== undefined) {
        markUsed(target, local);
      }
    }
  }

  // `export * from` and `export * as ns from`.
  for (const match of source.matchAll(
    /\bexport\s+\*(?:\s+as\s+[\w$]+)?\s+from\s*["']([^"']+)["']/g,
  )) {
    const target = resolveSpecifier(file, match[1]);
    if (target !== undefined) {
      fullyUsed.add(target);
    }
  }

  // Static imports: default, named and namespace forms.
  for (const match of source.matchAll(
    /\bimport\s+(?:type\s+)?([^"';]*?)\s*from\s*["']([^"']+)["']/g,
  )) {
    const target = resolveSpecifier(file, match[2]);
    if (target === undefined) {
      continue;
    }
    const clause = match[1];
    if (/\*\s+as\s+/.test(clause)) {
      fullyUsed.add(target);
    }
    const braces = /\{([^}]*)\}/.exec(clause);
    if (braces !== null) {
      for (const [name] of parseNamedClause(braces[1])) {
        markUsed(target, name);
      }
    }
    if (/^\s*(?:type\s+)?[A-Za-z_$][\w$]*\s*(?:,|$)/.test(clause)) {
      markUsed(target, "default");
    }
  }

  // Dynamic imports and `new URL("./x", import.meta.url)` (workers, assets).
  for (const match of source.matchAll(
    /\bimport\(\s*["']([^"']+)["']\s*\)|\bnew\s+URL\(\s*["']([^"']+)["']\s*,\s*import\.meta\.url/g,
  )) {
    const target = resolveSpecifier(file, optionalGroup(match, 1) ?? match[2]);
    if (target !== undefined) {
      fullyUsed.add(target);
    }
  }
}

/** @type {string[]} */
const unused = [];
for (const [file, names] of exported) {
  if (fullyUsed.has(file)) {
    continue;
  }
  const usedNames = used.get(file) ?? new Set();
  for (const name of names) {
    if (!usedNames.has(name)) {
      unused.push(`${relative(ROOT, file)}: ${name}`);
    }
  }
}

if (unused.length > 0) {
  console.error(`Unused exports (${String(unused.length)}):`);
  for (const line of unused.toSorted()) {
    console.error(`  ${line}`);
  }
  process.exit(1);
}
