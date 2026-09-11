/**
 * The cite grammars the engine's and the example chains' comment prose is
 * held to: dead release cites, module-path cites, and quoted test-title
 * cites — each with the resolver that decides whether a cite still points at
 * something.
 *
 * They live here rather than beside their assertions for the reason
 * `scanCorpus.ts`'s header gives — a grammar declared in the suite file
 * rides forward into red-on-base and its fix can never go red.
 */
import { readFileSync } from "node:fs";
import { join, sep } from "node:path";

import { REPO_ROOT, docsPages, scannedTreeFiles } from "./scanCorpus.ts";

// ---------- dead release cites ----------

/**
 * The release-spec corpus (`spec/RELEASE-v*.md`) is gone: one topic file per
 * subject replaced it, and no file carries a `§` numbering a reader can
 * follow. Every `RELEASE-v0.N §M` / `v0.N §M` cite left behind therefore
 * points at a file that does not exist — narration outliving its referent
 * (engineering.md, "Narration is the ladder's bottom rung"). Git carries the
 * provenance those cites were standing in for.
 *
 * Scope is `src/` and `examples/` entire, walked recursively — the engine's
 * own prose, and the reference chains a consumer reads as the worked answer
 * and copies wholesale (`engine-boundary.md`, "Opinion ships by name, opted
 * into") — plus every current-reference page of `docs/`, the published prose
 * a consumer reads before either. Nothing is scanned on an exclusion's word:
 * the cut and this refusal ship together, so no file is left pinned only by a
 * promise that a later entry will reach it.
 */

/**
 * The cite grammar: a `RELEASE-v` prefix on its own, or a version token and a
 * `§` close enough together to be one citation rather than two unrelated
 * mentions. Both orders occur — `v0.8 §4` and `(§6, v0.6.2)` — so both are
 * spelled. Neither alternative crosses a newline, which after `proseOf`
 * below survives only where the source left prose.
 */
export const RELEASE_CITE_RE =
  /RELEASE-v\d+\.\d+(?:\.\d+)?|v\d+\.\d+(?:\.\d+)?[^§\n]{0,24}§|§[^§v\n]{0,24}v\d+\.\d+(?:\.\d+)?/;

/**
 * Comment prose as one reader-visible run: strip each comment line's `*` /
 * `//` marker and join, so a cite wrapped across two lines still reads as one
 * phrase. Code lines become newlines, which the needle above refuses to
 * cross — two unrelated mentions on either side of a statement never compose
 * into a false hit.
 */
export function unwrapProse(text: string): string {
  return text
    .split("\n")
    .map((line) =>
      /^\s*(?:\*|\/\/)/.test(line) ? line.replace(/^\s*(?:\*|\/\/)\s?/, "") : "\n",
    )
    .join(" ");
}

/**
 * Reader-visible prose per file: the comment runs in TypeScript, the whole
 * text in Markdown, where every line is already prose. Both join their lines,
 * so a cite wrapped across two of them still reads as one phrase.
 */
export function proseOf(path: string, text: string): string {
  return path.endsWith(".ts") ? unwrapProse(text) : text.split("\n").join(" ");
}

/**
 * The corpus the release-cite refusal reads: every file under the scanned
 * roots, plus the `docs/` pages that declare themselves current reference.
 */
export function citeScannedFiles(): string[] {
  return [
    ...scannedTreeFiles(),
    ...docsPages()
      .filter((p) => p.current)
      .map((p) => p.path),
  ].sort();
}

// ---------- module-path cites ----------

/**
 * A doc comment that names another module — "`quarantineKey`
 * (`src/Dispatcher.ts`)" — is a pointer a reader follows, and the cheapest
 * prose there is to get wrong: nothing moves it when the symbol moves. Four
 * extraction waves have now stranded cites this way, and each round was
 * repointed by hand, which is narration defending itself with discipline
 * (`.claude/rules/engineering.md`, "Narration is the ladder's bottom rung").
 * This is the rung above: the cite is checked against the tree it points at.
 *
 * **Declares, not references.** A cite resolves only when the named module
 * *declares* the symbol — an import of it does not count. The looser reading
 * is measurably toothless: at `a18b40e^`, `src/Dispatcher.ts` still imported
 * `superviseLoop`, `createWorktree` and `harvestFriction` after the
 * extraction moved them, so "the module mentions it" would have passed over
 * the entire class of staleness this scan exists to catch.
 *
 * Scope is `src/` and `examples/` — the engine's own prose and the worked
 * chains a consumer copies. `spec/` carries the same shape and is human-only
 * (chain.ts writable-paths), so its half is not swept from here.
 */

/** A module path a cite can name: a TypeScript file in a scanned tree. */
export const CITE_MODULE_RE = "(?:src|examples|tests|bin|scripts)/[A-Za-z0-9_./-]+\\.ts";

/** A backticked symbol, dotted or not: `quarantineKey`, `git.readFileAtRef`. */
const CITE_SYMBOL_RE = "`([A-Za-z_$][\\w$]*(?:\\.[A-Za-z_$][\\w$]*)*)`";

/** A module path as prose spells it: backticked or bare, with an optional `:NN` line. */
const CITE_PATH_RE = `\`?(${CITE_MODULE_RE})(?::\\d+)?\`?`;

/**
 * The three shapes this corpus writes a cite in. Two are parenthesized and
 * differ only in order — "`sym` (`src/x.ts`)" and its comma variant "`sym`,
 * `src/x.ts`" read symbol-first; "(`src/x.ts`, `git.readFileAtRef`)" reads
 * module-first. The third is the colon shape, `src/x.ts:sym`, which is
 * spelled tightly on purpose: no space around the colon and no backtick
 * between, so "`src/x.ts`: it is …" — a path ending a clause, followed by
 * ordinary prose — is not a cite.
 */
export const CITE_SHAPES: readonly { shape: "colon" | "parenthesized"; re: RegExp; pathAt: number; symbolAt: number }[] = [
  { shape: "parenthesized", re: new RegExp(`${CITE_SYMBOL_RE}\\s*,?\\s*\\(?\\s*${CITE_PATH_RE}`, "g"), pathAt: 2, symbolAt: 1 },
  { shape: "parenthesized", re: new RegExp(`${CITE_PATH_RE}\\s*,?\\s+${CITE_SYMBOL_RE}`, "g"), pathAt: 1, symbolAt: 2 },
  { shape: "colon", re: new RegExp(`(${CITE_MODULE_RE}):([A-Za-z_$][\\w$]*(?:\\.[A-Za-z_$][\\w$]*)*)`, "g"), pathAt: 1, symbolAt: 2 },
];

export interface ModuleCite {
  /** The file whose comment carries the cite. */
  from: string;
  /** The module the cite names. */
  path: string;
  /** The symbol the cite names, as written — possibly dotted. */
  symbol: string;
  shape: "colon" | "parenthesized";
}

/**
 * Every file under the cite-scanned roots paired with its reader-visible
 * prose — the corpus both comment-cite scans read, walked once so neither
 * scan carries its own copy of the descent.
 */
export function citeProseCorpus(): { from: string; prose: string }[] {
  return scannedTreeFiles().map((from) => ({
    from,
    prose: proseOf(from, readFileSync(join(REPO_ROOT, from), "utf8")),
  }));
}

/** Every module-path cite in the comment prose of `src/` and `examples/`. */
export function moduleCites(): ModuleCite[] {
  const cites: ModuleCite[] = [];
  for (const { from, prose } of citeProseCorpus()) {
    const seen = new Set<string>();
    for (const { shape, re, pathAt, symbolAt } of CITE_SHAPES) {
      for (const m of prose.matchAll(re)) {
        const path = m[pathAt]!.split("/").join(sep);
        const symbol = m[symbolAt]!;
        if (seen.has(`${path}|${symbol}`)) continue;
        seen.add(`${path}|${symbol}`);
        cites.push({ from, path, symbol, shape });
      }
    }
  }
  return cites;
}

/**
 * A module's declaring body: comments gone, and every name-binding `import`
 * or `export … from` gone with them. Stripping those is the whole difference
 * between "declares" and "references" — an extraction leaves the import
 * behind at the old home, which is exactly the tree a cite goes stale
 * against.
 */
export function declaringBody(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((line) => line.replace(/(^|[^:"'`])\/\/.*$/, "$1"))
    .join("\n")
    .replace(/^\s*import\s[\s\S]*?from\s+["'][^"']+["'];?\s*$/gm, "")
    .replace(/^\s*import\s+["'][^"']+["'];?\s*$/gm, "")
    .replace(/^\s*export\s*\{[\s\S]*?\}\s*from\s+["'][^"']+["'];?\s*$/gm, "");
}

/**
 * Does `body` declare `name`? Three forms cover what this corpus cites: a
 * top-level `function` / `const` / `class` / `interface` / `type` / `enum`
 * binding, a member or property declaration (a class method, an interface
 * field, an object-literal key), and a shorthand property.
 */
export function declaresSymbol(body: string, name: string): boolean {
  const n = name.replace(/\$/g, "\\$&");
  return [
    new RegExp(`^\\s*(?:export\\s+)?(?:declare\\s+)?(?:default\\s+)?(?:abstract\\s+)?(?:async\\s+)?(?:function|const|let|var|class|interface|type|enum)\\s+${n}\\b`, "m"),
    new RegExp(`^\\s*(?:(?:public|private|protected|readonly|static|abstract|async|get|set)\\s+)*${n}\\s*[(<?:=]`, "m"),
    new RegExp(`^\\s*${n}\\s*,\\s*$`, "m"),
  ].some((p) => p.test(body));
}

/**
 * Resolve a cite against the tree. A dotted symbol resolves against its last
 * segment — `Chain.supervisorPolicy.maxParallel` is the `maxParallel` field
 * the named module declares, and the path in front of it is the reader's
 * route to it, not a second file to open.
 */
export function resolveCite(cite: ModuleCite): string | null {
  let body: string;
  try {
    body = declaringBody(readFileSync(join(REPO_ROOT, cite.path), "utf8"));
  } catch {
    return `${cite.from} cites ${cite.path}, which does not exist`;
  }
  const leaf = cite.symbol.split(".").at(-1)!;
  return declaresSymbol(body, leaf)
    ? null
    : `${cite.from} cites \`${cite.symbol}\` in ${cite.path}, which does not declare ${leaf}`;
}

// ---------- quoted test-title cites ----------

/**
 * The other half of the same pointer: a doc comment that names the *test*
 * pinning what the sentence just claimed — "byte shape pinned by
 * tests/Prompt.test.ts's "byte-identical to the pre-§2 collapsed rendering"
 * case". `CITE_SHAPES` above cannot see one: every shape there requires a
 * backticked symbol, and a test title is a sentence in quotes, so the whole
 * class was selected at zero — a green verdict over an empty set
 * (`.claude/rules/engineering.md`, "A green verdict is proven non-vacuous").
 *
 * These rot the same way and more quietly: a suite extraction moves the
 * `it(…)` and leaves the pointer behind, and the sentence still reads as
 * though something is watching. Resolution is by *title*, not by symbol —
 * the quoted text is a substring of the named file — because a title is what
 * a reader searches for and what a rename changes.
 */
const CITE_TEST_MODULE_RE = "tests/[A-Za-z0-9_./-]+\\.test\\.ts";

/**
 * A quoted test title: straight double quotes, no newline between them —
 * after `proseOf` a newline is a code line, so the needle never composes a
 * quote in one comment run with a quote in the next. The length floor keeps
 * a one-word quoted term ("run", "none") from reading as a title.
 */
const CITE_TITLE_RE = '"([^"\\n]{8,})"';

/**
 * Both orders the corpus writes, mirroring `CITE_SHAPES`: path-first —
 * `tests/Gate.test.ts's "…"`, `tests/Dispatcher.test.ts, "…"` — and
 * title-first, where the path follows the quote in parentheses. Each demands
 * the quote and the path be adjacent, so a path that merely ends a clause
 * ahead of ordinary prose is not a cite.
 */
export const TITLE_CITE_SHAPES: readonly {
  order: "path-first" | "title-first";
  re: RegExp;
  pathAt: number;
  titleAt: number;
}[] = [
  {
    order: "path-first",
    re: new RegExp(`\`?(${CITE_TEST_MODULE_RE})\`?(?:'s)?\\s*,?\\s+${CITE_TITLE_RE}`, "g"),
    pathAt: 1,
    titleAt: 2,
  },
  {
    order: "title-first",
    re: new RegExp(`${CITE_TITLE_RE}\\s*,?\\s*\\(?\\s*\`?(${CITE_TEST_MODULE_RE})\`?`, "g"),
    pathAt: 2,
    titleAt: 1,
  },
];

export interface TitleCite {
  /** The file whose comment carries the cite. */
  from: string;
  /** The test module the cite names. */
  path: string;
  /** The test title the cite quotes, as written. */
  title: string;
  order: "path-first" | "title-first";
}

/** Every quoted test-title cite in the comment prose of `src/` and `examples/`. */
export function titleCites(): TitleCite[] {
  const cites: TitleCite[] = [];
  for (const { from, prose } of citeProseCorpus()) {
    const seen = new Set<string>();
    for (const { order, re, pathAt, titleAt } of TITLE_CITE_SHAPES) {
      for (const m of prose.matchAll(re)) {
        const path = m[pathAt]!.split("/").join(sep);
        const title = m[titleAt]!;
        if (seen.has(`${path}|${title}`)) continue;
        seen.add(`${path}|${title}`);
        cites.push({ from, path, title, order });
      }
    }
  }
  return cites;
}

/**
 * Resolve a title cite against the tree: the named file exists and carries
 * the quoted title. Whitespace is flattened on both sides — a title the
 * comment wrapped across two lines is the same title the `it(…)` spells on
 * one.
 */
export function resolveTitleCite(cite: TitleCite): string | null {
  const flat = (s: string) => s.replace(/\s+/g, " ").trim();
  let text: string;
  try {
    text = readFileSync(join(REPO_ROOT, cite.path), "utf8");
  } catch {
    return `${cite.from} cites ${cite.path}, which does not exist`;
  }
  return flat(text).includes(flat(cite.title))
    ? null
    : `${cite.from} cites "${cite.title}" in ${cite.path}, which carries no such title`;
}
