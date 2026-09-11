/**
 * The spec-lint needles: the path and line-locator grammars a `spec/` page is
 * refused on, and the dotted-symbol grammar whose cites are resolved against
 * `src/`.
 *
 * They live here rather than beside their assertions for the reason
 * `scanCorpus.ts`'s header gives — a grammar declared in the suite file
 * rides forward into red-on-base and its fix can never go red.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { REPO_ROOT } from "./scanCorpus.ts";
import { declaresSymbol, declaringBody } from "./citeScanners.ts";

/**
 * `.claude/rules/spec-writing.md` ("A claim names behavior, never location")
 * lets a spec sentence name behavior and public surface, and refuses a `src/`
 * file path or a line number: where a symbol lives is layout, and layout is
 * build's lane. That refusal is the one half of the spec-lint pin this scan
 * carries — a locator rots on the next extraction while still reading as
 * authoritative, and nothing but a reader's memory was watching for one.
 *
 * A path is not always a locator, which is why the `src/` half is an
 * allowlist rather than a ban. Two claims take a module as their *subject*:
 * the export inventory, which the rule itself names as public surface, and
 * the deep-import specifier packaging refuses, where the string is what a
 * consumer types. Each surviving path is named below with which it is; a new
 * one fails until it is.
 *
 * The line-number half is a flat refusal — no claim in this corpus has a line
 * as its subject — so it asserts the empty case explicitly (`engineering.md`,
 * "A green verdict is proven non-vacuous"), with the grammar driven both ways
 * beside it.
 *
 * The `tests/` half is the same flat refusal, and for a stronger reason: the
 * rule's third bullet refuses a test title or a fixture outright, because
 * tests pin the spec and the spec does not cite them. There is no
 * allowlist-shaped escape the way `src/` has one — no spec claim takes a test
 * file as its subject — so the refusal is unconditional, currently green over
 * zero sites, and the emptiness is spelled here rather than inherited from a
 * silent `[]`.
 *
 * It refuses a *concrete* test file by either spelling: under the root
 * (`tests/Dispatcher.test.ts`) or as the bare filename a sentence drops the
 * root from (`Dispatcher.test.ts`). Dropping the root does not make a locator
 * anything else — a reader still has one file to open, and a rename still
 * leaves the page asserting a name the tree no longer carries. What it leaves
 * alone is the lane's glob, `*.integration.test.ts`: that string is the
 * marker a consumer types to put a suite in the slow lane, so it is the
 * claim's own subject, not a route to a symbol — the same ground the sibling
 * roots below stand on.
 *
 * Its sibling roots are deliberately *not* swept. `bin/flume.js`, `bin/env`,
 * `scripts/smoke-install.mjs` and `examples/backlog-groomer-chain.ts` are each
 * a claim's subject — a shim the package ships, a fixture set CI installs
 * against, a reference chain a consumer copies — not a route to a symbol, and
 * `spec-writing.md` refuses neither. Widening the needle to them would be a
 * ban the page never states.
 *
 * Scope is `spec/` alone. The same shape in `src/` and `examples/` is swept
 * by `citeScanners.ts`, which can resolve a cite against a named file; `spec/`
 * is human-only (chain.ts writable-paths), so a finding here leaves as a
 * directed edit rather than a build fix.
 */

/**
 * A `src/` file path. Matched wherever it starts, including inside a longer
 * specifier — `@dtmd/flume/src/Dispatcher.ts` names the module as surely as a
 * bare cite does. Segments carry no dots before the extension, which is what
 * keeps a bare `src/` directory mention out — "a section that no longer
 * matches `src/`" names the tree, not a route to a symbol, and the corpus
 * writes that sentence routinely.
 */
export const SPEC_SRC_PATH = /src\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*\.[A-Za-z]{1,5}/g;

/**
 * A `path:NN` line locator: any filename with an extension, followed
 * immediately by a colon and digits. Not anchored to `src/` — a line number
 * is refused wherever it points, and `spec/chain.md:120` would be the same
 * defect aimed at a sibling page.
 *
 * The leading lookbehind bars a start inside a URL authority, so a
 * `https://host:443/x` port is not read as a line. A path that merely *ends*
 * a clause — "`spec/jobs.md`, *Runtime ignores*" — carries no digits and
 * never reaches the colon.
 */
export const SPEC_LINE_LOCATOR =
  /(?<![A-Za-z0-9_.:/-])[A-Za-z0-9_./-]*[A-Za-z0-9_-]\.[A-Za-z]{1,5}:\d+/g;

/**
 * A path under a `tests/` root, anchored on the root itself: `tests/x.ts`,
 * `tests/fixtures/chain.ts`, and the same path inside a longer prefix
 * (`flume/tests/x.ts`). The lookbehind bars a word character before `tests`,
 * so `integration-tests/…` is a different root and not this one.
 *
 * Unlike the `src/` needle, segments may carry dots — `.test.ts` is the
 * convention every file under that root follows, and a truncated hit would
 * report the violation by the wrong name.
 *
 * An extension is required, which is what keeps a bare directory mention out:
 * a sentence naming `tests/` as a lane names the tree, not a file. The same
 * file named without its root is the sibling needle below.
 */
export const SPEC_TEST_PATH =
  /(?<![A-Za-z0-9_.-])tests\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*\.[A-Za-z]{1,5}/g;

/**
 * The same file named without its root: `Dispatcher.test.ts`,
 * `examples.integration.test.ts`. A test file's tail is what identifies it —
 * `.test.` followed by a JS/TS extension — so the needle keys on the tail and
 * takes whatever dotted name precedes it. Keying on the tail is also what
 * keeps every other rootless filename the corpus writes out: `chain.ts` and
 * `pending.json` name artifacts, not suites.
 *
 * The lookbehind is what separates a filename from the lane's glob. A hit may
 * not start after `*`, `.` or `/`, so `*.integration.test.ts` matches at no
 * position: every start inside it sits behind a dot or the star, and the
 * pattern needs a name segment ahead of `.test.`. The same lookbehind keeps a
 * rooted path from being reported twice — `tests/Dispatcher.test.ts` is the
 * needle above's hit, by its full name.
 */
export const SPEC_TEST_FILENAME =
  /(?<![A-Za-z0-9_.*/-])[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*\.test\.[cm]?[jt]s(?![A-Za-z0-9_-])/g;

/**
 * The `src/` paths a spec page may name, each with the claim that takes the
 * module as its subject. An entry leaves in the commit that removes its last
 * site; the equality below refuses a stale one as loudly as a new locator.
 */
export const SPEC_SRC_PATH_ALLOWLIST: Record<string, string> = {
  "src/index.ts":
    "the export inventory is the claim's subject — spec-writing.md names an " +
    "export of `src/index.ts` as public surface, and the pages point at the " +
    "module instead of restating what it lists",
  "src/Dispatcher.ts":
    "the deep-import specifier packaging refuses " +
    "(`@dtmd/flume/src/Dispatcher.ts`) — the string is what a consumer types, " +
    "not a route to a symbol",
};

/** Distinct `src/` paths a page names, in source order. */
export function srcPathsIn(text: string): string[] {
  return [...new Set(text.match(SPEC_SRC_PATH) ?? [])];
}

/** Every `tests/` path a page names, as written. */
export function testPathsIn(text: string): string[] {
  return text.match(SPEC_TEST_PATH) ?? [];
}

/** Every rootless test filename a page names, as written. */
export function testFilenamesIn(text: string): string[] {
  return text.match(SPEC_TEST_FILENAME) ?? [];
}

/** Every `path:NN` locator a page carries, as written. */
export function lineLocatorsIn(text: string): string[] {
  return text.match(SPEC_LINE_LOCATOR) ?? [];
}

/**
 * The other half of the spec-lint pin (`.claude/rules/spec-writing.md`, "What
 * holds this page above prose"): the path half above refuses a locator, and
 * this one holds the names a page is left with. `spec-writing.md` ("A claim
 * names behavior, never location") sends every sentence that wanted a path to
 * a **public name** instead — which only stays true while the name does. A
 * renamed field leaves the spec asserting a member the engine no longer has,
 * in the one form the page told the author to prefer, and nothing but a
 * reader's memory was watching.
 *
 * **Subject: a dotted token whose prefix is a public type.** The page's
 * *Public surface* bullet is the authority for which types those are, so the
 * prefix set is read off the bullet itself and off `src/index.ts`'s export
 * inventory — the two surfaces the bullet names — rather than restated here
 * (`engineering.md`, *Derived state is computed, never restated beside its
 * source*). Keying on the prefix is also what keeps ordinary prose out: this
 * corpus writes `process.env.FLUME_DIR`, `core.longpaths` and `cmd.exe` in
 * backticks routinely, and none of them is a claim about this engine's
 * surface. No vocabulary list does that work; the export inventory does.
 *
 * **Resolved on the last segment, anywhere in `src/`.** `Chain.seedDir` is
 * the `seedDir` field, and the type in front of it is the reader's route to
 * it. The page may not name the module that declares it — that is the path
 * half's whole point — so the resolution is over the tree, not over a named
 * file as `citeScanners.ts`'s comment-cite scan resolves.
 */

/**
 * A backticked dotted token: `Chain.seedDir`, `api.paths.flumeDir`. Two
 * segments minimum — a bare `createWorktree` names no type and is out of
 * subject.
 */
export const SPEC_DOTTED_RE = /`([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+)`/g;

/**
 * Filename tails. `Dispatcher.test.ts` wears the subject's shape — a public
 * type, then dotted segments — but names a file, which is the path half's
 * subject, not a member of anything. The tail is the only structural thing
 * that tells it from `Chain.friction`.
 */
const FILENAME_TAILS = new Set(["ts", "js", "mjs", "cjs", "json", "md", "lock", "exe"]);

/**
 * The types the *Public surface* bullet names, read off the bullet. Taking
 * them from the page means a ninth type ratified there widens this scan in
 * the same commit, rather than in whichever later one notices.
 */
export function publicSurfaceTypes(): string[] {
  const page = readFileSync(join(REPO_ROOT, ".claude", "rules", "spec-writing.md"), "utf8");
  const bullet = /^- \*\*Public surface\*\*([\s\S]*?)(?=^- |\n\n)/m.exec(page);
  if (!bullet) return [];
  return [...new Set([...bullet[1]!.matchAll(/`([A-Z][\w$]*)`/g)].map((m) => m[1]!))];
}

/** Every name `src/index.ts` re-exports — the bullet's other named surface. */
export function indexExports(): string[] {
  const idx = readFileSync(join(REPO_ROOT, "src", "index.ts"), "utf8");
  const names = new Set<string>();
  for (const block of idx.matchAll(/export\s+(?:type\s+)?\{([\s\S]*?)\}\s*from/g)) {
    for (const part of block[1]!.split(",")) {
      const spec = part.trim().replace(/^type\s+/, "").split(/\s+as\s+/);
      const name = (spec[1] ?? spec[0] ?? "").trim();
      if (/^[A-Za-z_$][\w$]*$/.test(name)) names.add(name);
    }
  }
  return [...names];
}

/** Every `src/` module's declaring body — where a last segment has to land. */
export function srcDeclaringBodies(): string[] {
  return readdirSync(join(REPO_ROOT, "src"), { recursive: true, encoding: "utf8" })
    .map((name) => join(REPO_ROOT, "src", name))
    .filter((path) => statSync(path).isFile() && path.endsWith(".ts"))
    .map((path) => declaringBody(readFileSync(path, "utf8")));
}

export interface SpecSymbolCite {
  /** The spec page carrying the cite. */
  page: string;
  /** The dotted token, as written. */
  symbol: string;
}

/** Every in-subject dotted cite a page carries, deduped per page. */
export function specSymbolCites(pages: { path: string; text: string }[], prefixes: Set<string>): SpecSymbolCite[] {
  const cites: SpecSymbolCite[] = [];
  for (const page of pages) {
    const seen = new Set<string>();
    for (const m of page.text.matchAll(SPEC_DOTTED_RE)) {
      const symbol = m[1]!;
      const segments = symbol.split(".");
      if (!prefixes.has(segments[0]!)) continue;
      if (FILENAME_TAILS.has(segments.at(-1)!)) continue;
      if (seen.has(symbol)) continue;
      seen.add(symbol);
      cites.push({ page: page.path, symbol });
    }
  }
  return cites;
}

/**
 * The member cites `src/` deliberately does not declare, each with the claim
 * that needs the name in order to deny it. A spec section whose subject is an
 * absence — a knob that does not exist, a verb that was removed — has to
 * spell the absent name or say nothing, and an unresolvable cite is the
 * correct shape for it. The equality below refuses a stale entry as loudly as
 * a newly-stranded cite: when the engine grows one of these, its line leaves
 * in the same commit the spec section does.
 */
export const SPEC_ABSENT_SYMBOLS: Record<string, string> = {
  "Chain.harvest":
    "removed with `job extract`, and nothing replaced it — the section's " +
    "subject is that there is no clean-history ending",
  "Chain.worktreesDir":
    "never existed: the worktree base is machine-local placement, and the " +
    "section names the knob to say a committed chain file is the wrong home",
  "DispatcherOptions.trunkBranch":
    "does not exist, and the absence is pinned type-level — the section " +
    "names it to bound the fanout branch carve-out beside it",
};

/**
 * Is a cite's last segment declared nowhere in `bodies`? Curried on the
 * `src/` side so the suite binds the corpus once and passes the predicate to
 * `filter` (`engineering.md`, *A green verdict is proven non-vacuous*: the
 * bodies it closes over are asserted populated before any verdict is read).
 */
export const unresolvedSpecCite =
  (bodies: string[]) =>
  (cite: SpecSymbolCite): boolean =>
    !bodies.some((body) => declaresSymbol(body, cite.symbol.split(".").at(-1)!));
