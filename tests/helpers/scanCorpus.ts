/**
 * Corpus readers for the retired-narration suite: the repo root every scan
 * resolves against, the file lists the scans read, and the `docs/` and
 * `spec/` page inventories.
 *
 * The suite's scanners live under `tests/helpers/` rather than beside their
 * assertions because the suite is its own subject. `.flume/vitestJudge.ts`
 * proves a fix red on the base by laying the merged bytes of each file
 * holding a named test over the pre-fix tree — so a grammar declared in the
 * suite file rides forward inside that copy, and a fix to it can never go
 * red. A scanner imported from here is read at its base version instead.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));

/** A repo-relative file, read whole. */
export const readDoc = (...parts: string[]): string =>
  readFileSync(join(REPO_ROOT, ...parts), "utf8");

/** The dogfood chain — the surface both retired shapes lived on longest. */
export const CHAIN_PATH = join(".flume", "chain.ts");

/**
 * The reference chains. `engine-boundary.md` ("Opinion ships by name, opted
 * into") makes `examples/` where this repo's recommended shapes live, so a
 * chain author reads them as the worked answer — the same job the dogfood
 * chain does, on a surface a consumer copies wholesale.
 */
export function exampleChainPaths(): string[] {
  return readdirSync(join(REPO_ROOT, "examples"))
    .filter((name) => name.endsWith(".ts"))
    .map((name) => join("examples", name))
    .sort();
}

/** Every file whose prose teaches a chain author how to write a chain. */
export function scannedPaths(): string[] {
  const docs = readdirSync(join(REPO_ROOT, "docs"))
    .filter((name) => name.endsWith(".md") && !name.startsWith("MIGRATING-"))
    .map((name) => join("docs", name));
  const src = readdirSync(join(REPO_ROOT, "src"))
    .filter((name) => name.endsWith(".ts"))
    .map((name) => join("src", name));
  return [...docs, ...src, ...exampleChainPaths(), "README.md", CHAIN_PATH];
}

/** The trees a chain author reads the shapes off: engine, and worked example. */
export const CITE_SCANNED_ROOTS = ["src", "examples"];

/**
 * `docs/` is the one scanned tree where a dead cite can be the point. A
 * migration guide, a port finding, and a design record each describe a moment
 * that has passed, and a `v0.N §M` cite in one names the corpus that existed
 * then — provenance, not a pointer a reader is meant to follow.
 *
 * So `docs/` is **partitioned, never excluded**: each page declares which it
 * is, in a blockquote under its own H1, and the two declarations must cover
 * the directory exactly. The declaration lives on the page rather than in an
 * inventory here for two reasons — the reader who lands on
 * `docs/CASCADE-DRY-RUN.md` and hits `v0.8 §4` is the one who needs it, and a
 * list here would be a second copy of a fact the page owns (`engineering.md`,
 * *Derived state is computed, never restated beside its source*). A new page
 * carries neither marker and fails the partition below until it picks one.
 */
export const CURRENT_REFERENCE = /^>\s*\*\*Current reference\.\*\*/m;
export const DATED_RECORD = /^>\s*\*\*Dated record\.\*\*/m;

/** Every `.md` page of `docs/`, with the status each one declares. */
export function docsPages(): { path: string; text: string; current: boolean; dated: boolean }[] {
  return readdirSync(join(REPO_ROOT, "docs"))
    .filter((name) => name.endsWith(".md"))
    .sort()
    .map((name) => {
      const path = join("docs", name);
      const text = readFileSync(join(REPO_ROOT, path), "utf8");
      return {
        path,
        text,
        current: CURRENT_REFERENCE.test(text),
        dated: DATED_RECORD.test(text),
      };
    });
}

/** Every `.md` page of `spec/`, read whole — fenced code included. */
export function specPages(): { path: string; text: string }[] {
  return readdirSync(join(REPO_ROOT, "spec"))
    .filter((name) => name.endsWith(".md"))
    .sort()
    .map((name) => {
      const path = join("spec", name);
      return { path, text: readFileSync(join(REPO_ROOT, path), "utf8") };
    });
}

/**
 * Every file under the cite-scanned roots, recursively — `examples/prompts/`
 * is the descent a top-level `readdirSync` would silently drop. Walked once
 * here so neither cite scan carries its own copy of it.
 */
export function scannedTreeFiles(): string[] {
  return CITE_SCANNED_ROOTS.flatMap((root) =>
    readdirSync(join(REPO_ROOT, root), { recursive: true, encoding: "utf8" })
      .map((name) => join(root, name))
      .filter((path) => statSync(join(REPO_ROOT, path)).isFile())
      .sort(),
  );
}
