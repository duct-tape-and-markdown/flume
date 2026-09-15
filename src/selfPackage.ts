/**
 * Flume's own package manifest: where it sits relative to a module the
 * package ships, and the version that manifest declares.
 *
 * **Two readers, one derivation.** `flume --version` (`src/cli.ts`) reports
 * it, and `flume-harness init` (`harness/init.ts`) writes it into the
 * dependency line a consumer adopts the package by. A second hop list beside
 * this one is a layout change that fixes one surface and strands the other
 * (`.claude/rules/engineering.md`, *The fix lands at the mechanism*).
 *
 * Its own module rather than a corner of the CLI, for the reason
 * `src/fsProbe.ts` is: the harness package needs this and must not pull the
 * CLI in behind it. `src/cli.ts` decides at module scope whether it was
 * invoked directly, and the chain loader's `tsImport` namespacing makes a
 * second physical instance of a module reachable in one process — so a
 * harness module importing the CLI is a second `main()` waiting for the
 * layout that lines the two paths up. Nothing here reaches past `node:fs`,
 * `node:path` and the loud probe.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { existsLoud } from "./fsProbe.js";

/**
 * The hops from the directory holding a shipped module to flume's own
 * package.json, one per shipped layout: a checkout runs the module one
 * directory under the package root (`src/cli.ts`, `harness/init.ts`), and
 * `tsconfig.build.json` (rootDir `.`) emits it two under (`dist/src/cli.js`,
 * `dist/harness/init.js`). Ordered checkout-first; the first that exists
 * wins.
 */
const PACKAGE_JSON_HOPS = ["..", "../.."] as const;

/**
 * Flume's own package.json, resolved from the directory holding the calling
 * module. No layout is guessed from what happens to be on disk above
 * `fromDir`: only the declared hops are tried, and none existing throws
 * naming every path tried rather than reporting a placeholder version
 * (`.claude/rules/engineering.md`, "Loud or nothing").
 */
export function resolvePackageJson(fromDir: string): string {
  const tried = PACKAGE_JSON_HOPS.map((hop) =>
    resolve(fromDir, hop, "package.json"),
  );
  const found = tried.find((candidate) => existsLoud(candidate));
  if (found === undefined) {
    throw new Error(
      `flume: no package.json at any of ${tried.join(", ")} — ` +
        `the CLI cannot report its own version`,
    );
  }
  return found;
}

/** How flume names and versions itself, as its own manifest declares it. */
interface SelfPackage {
  /** The name flume publishes under — the specifier a consumer depends on. */
  readonly name: string;
  /** The version that manifest declares. */
  readonly version: string;
}

/**
 * Flume's own name and version, or a throw naming the manifest and the field
 * at fault. A manifest that parses but carries neither would otherwise reach
 * a `--version` line, or a consumer's dependency spec, as `undefined`
 * (`.claude/rules/engineering.md`, "Loud or nothing").
 */
export function readSelfPackage(fromDir: string): SelfPackage {
  const pkgPath = resolvePackageJson(fromDir);
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as Record<
    string,
    unknown
  >;
  const read = (field: "name" | "version"): string => {
    const value = pkg[field];
    if (typeof value !== "string") {
      throw new Error(`package.json at ${pkgPath} has no string "${field}"`);
    }
    return value;
  };
  return { name: read("name"), version: read("version") };
}

/** The version flume's own manifest declares — `flume --version`'s answer. */
export function readPackageVersion(fromDir: string): string {
  return readSelfPackage(fromDir).version;
}
