/**
 * The `*.md` pages a reader who *installed* this package holds — the file set
 * the manifest's `files` list packs, as against the tree those pages were
 * written in (`spec/harness.md`, *Adoption and upgrade*).
 *
 * A page the package puts in front of a consumer resolves its own page names
 * against that set and not against this checkout: its reader stands in a
 * repository that holds no `spec/` corpus, so a name this tree answers by
 * being the tree it was written in is a dead pointer in the one surface that
 * reader cannot check. The working tree is the wrong authority there, and
 * this module is the right one.
 *
 * Read off the real manifest rather than restated beside it: the list a
 * consumer's `npm install` obeys is the one `package.json` states, and a
 * second copy here would pass a directory the manifest stopped packing
 * (`.claude/rules/engineering.md`, *A seam gate reads what the real writer
 * wrote*).
 *
 * **Pages, not the whole pack.** The one question a citation asks is whether
 * the install carries the page it names, so the walk collects `.md` and
 * stops there — the emitted modules under `dist/` are the build's to produce
 * and nothing cites one by path. Narrowing the walk is also what keeps it off
 * the trees a packed-set walk has no business descending: every candidate
 * comes from a directory the manifest itself named.
 *
 * Not *.test.ts, so neither vitest lane collects it as a suite of its own.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { matchesAny } from "../../src/paths.ts";
import { filesUnder, relPath } from "./repoProgram.ts";

/** The extension a citation names, and the only one this reader collects. */
const PAGE_EXT = ".md";

/**
 * The root-level files npm packs whatever `files` says, and that no `!` rule
 * can subtract: the readme and the licence, in either spelling and at any
 * extension. Stated here because it is npm's rule rather than the manifest's,
 * and a reader that applied the list alone would report a manifest omitting
 * `README.md` as shipping none.
 */
const ALWAYS_PACKED = /^(?:readme|licen[cs]e)(?:\.[^/]+)?$/i;

/** One `files` entry: the glob it states, and whether it subtracts. */
interface PackRule {
  /** The glob, with the `!`, a leading `./` and a trailing `/` folded out. */
  readonly glob: string;
  /** Whether the entry removes what it matches rather than adding it. */
  readonly negated: boolean;
}

/**
 * The manifest's `files` list, as rules in the order it states them.
 *
 * A manifest stating no list packs its whole tree, which is a different rule
 * from the one this reader implements — refused rather than approximated, so
 * a caller never reads "packs everything" as "packs nothing"
 * (`.claude/rules/engineering.md`, *Loud or nothing*).
 */
const packRules = (root: string): PackRule[] => {
  const manifest: unknown = JSON.parse(
    readFileSync(join(root, "package.json"), "utf8"),
  );
  const listed = (manifest as { files?: unknown }).files;
  if (!Array.isArray(listed) || listed.length === 0)
    throw new Error(
      `${join(root, "package.json")} states no files list; this reader answers what a files list packs`,
    );
  return listed.map((entry: string) => {
    const negated = entry.startsWith("!");
    return {
      glob: (negated ? entry.slice(1) : entry)
        .replace(/^\.\//, "")
        .replace(/\/+$/, ""),
      negated,
    };
  });
};

/**
 * Whether a rule reaches a repo-relative path — the entry named as a file, or
 * as the directory it sits under. Both spellings through the engine's own
 * matcher, so `files` is read in the glob dialect the rest of the package
 * already speaks rather than in a second one grown here
 * (`matchesAny`, `src/paths.ts`).
 */
const reaches = (rule: PackRule, path: string): boolean =>
  matchesAny(path, [rule.glob, `${rule.glob}/**`]);

/**
 * Whether the pack carries a page: npm's always-packed names first, then the
 * manifest's rules in order, last match winning — which is what makes a `!`
 * entry behind a directory subtract from it.
 */
const packs = (rules: readonly PackRule[], path: string): boolean => {
  if (ALWAYS_PACKED.test(path)) return true;
  let verdict = false;
  for (const rule of rules) if (reaches(rule, path)) verdict = !rule.negated;
  return verdict;
};

/**
 * The leading segments of a glob that carry no wildcard — the one subtree a
 * rule can reach, and so the only place a candidate for it can be found.
 */
const globlessPrefix = (glob: string): string => {
  const segments = glob.split("/");
  const wild = segments.findIndex((segment) => segment.includes("*"));
  return (wild === -1 ? segments : segments.slice(0, wild)).join("/");
};

/** The root's own files, by name — where a rootward rule finds its candidates. */
const rootFiles = (root: string): string[] =>
  readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name);

/**
 * The pages one rule could reach, before the rule list decides any of them.
 *
 * A rule anchored on a directory contributes that directory's pages; one
 * anchored on a file contributes that file. A rule anchored on nothing —
 * `*.md` — contributes the root's own pages, and the `**` spelling of it is
 * **refused**: matching it means walking a tree this reader was never handed
 * a boundary for, and a walk that quietly skipped what it found inconvenient
 * would report a shipped page as unpacked (`.claude/rules/engineering.md`,
 * *Loud or nothing*).
 */
const candidatesFor = (root: string, rule: PackRule): string[] => {
  const prefix = globlessPrefix(rule.glob);
  if (prefix === "") {
    if (rule.glob.includes("**"))
      throw new Error(
        `files entry '${rule.glob}' is anchored on no directory; this reader walks the directories a manifest names`,
      );
    return rootFiles(root).filter((name) => name.endsWith(PAGE_EXT));
  }
  const path = join(root, prefix);
  if (!existsSync(path)) return [];
  if (statSync(path).isDirectory())
    return filesUnder({ root: path, suffix: PAGE_EXT }).map((file) =>
      relPath(root, file),
    );
  return prefix.endsWith(PAGE_EXT) ? [prefix] : [];
};

/**
 * Every `*.md` page the manifest at `root` packs, repo-relative and
 * posix-separated — the alphabet a citation is written in.
 *
 * An empty verdict is refused rather than returned: this package ships the
 * README at the least, and a reader that stopped finding pages would hand
 * every scan below a green over nothing
 * (`.claude/rules/engineering.md`, *A green verdict is proven non-vacuous*).
 */
export function packedPages(root: string): Set<string> {
  const rules = packRules(root);
  const candidates = new Set<string>([
    ...rules.filter((rule) => !rule.negated).flatMap((rule) => candidatesFor(root, rule)),
    ...rootFiles(root).filter((name) => ALWAYS_PACKED.test(name)),
  ]);
  const packed = new Set(
    [...candidates].filter((page) => packs(rules, page)).sort(),
  );
  if (packed.size === 0)
    throw new Error(
      `${join(root, "package.json")} packs no page; a citation scan over it would be green over nothing`,
    );
  return packed;
}
