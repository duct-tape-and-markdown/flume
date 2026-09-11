/**
 * Doc-claim readers: the markdown region parsers, and the `src/`-side
 * readers each claim about a state root's layout is held against.
 *
 * Both halves live here rather than beside their assertions for the reason
 * `scanCorpus.ts`'s header gives — a grammar declared in the suite file
 * rides forward into red-on-base and its fix can never go red.
 */
import { readdirSync } from "node:fs";
import { join, resolve } from "node:path";

import { expect } from "vitest";

import { worktreesBase } from "../../src/paths.ts";
import { REPO_ROOT, readDoc } from "./scanCorpus.ts";

// ---------- shared doc-claim readers ----------
//
// Both pins that use them hold a prose list against the `src/` value that
// writes it, and both read a doc the same way: find the paragraph that opens the claim,
// take the bullet list under it when one follows, and read the backticked
// tokens each chunk names. One set of readers, so the two pins cannot drift
// into two markdown dialects.


/**
 * The claim region for `marker`: the marker's own paragraph, plus a bullet
 * list beneath it when one follows. It ends at the first line that opens a
 * new block at column 0 — which is what keeps README's *chain*-placed list,
 * three lines further down, out of a scan about what the harness places.
 */
export function regionLines(text: string, marker: RegExp): string[] | null {
  const lines = text.split("\n");
  const start = lines.findIndex((l) => marker.test(l));
  if (start === -1) return null;
  const region: string[] = [];
  let i = start;
  while (i < lines.length && lines[i]!.trim() !== "") region.push(lines[i++]!);
  let j = i;
  while (j < lines.length && lines[j]!.trim() === "") j++;
  if (j < lines.length && /^-\s/.test(lines[j]!)) {
    region.push("");
    for (; j < lines.length; j++) {
      const l = lines[j]!;
      if (/^-\s/.test(l) || /^\s+\S/.test(l) || l.trim() === "") {
        region.push(l);
        continue;
      }
      break;
    }
  }
  return region;
}

/**
 * The region as claim chunks — the marker paragraph, then one chunk per
 * bullet with its continuation lines. Prose wraps, so a chunk is the unit a
 * claim is actually written in.
 */
export function claimChunks(lines: string[]): string[] {
  const out: string[][] = [];
  let cur: string[] | null = null;
  for (const line of lines) {
    if (/^-\s/.test(line)) {
      if (cur) out.push(cur);
      cur = [line];
    } else if (line.trim() === "") {
      if (cur) out.push(cur);
      cur = null;
    } else if (cur) cur.push(line);
    else cur = [line];
  }
  if (cur) out.push(cur);
  return out.map((chunk) => chunk.join(" "));
}

/**
 * The paths a chunk claims: every backticked token ahead of the chunk's
 * first em dash. The dash is where a chunk stops naming and starts
 * explaining, and the explanation legitimately names things that are not on
 * the list — a CLI invocation, a `Chain` field, the file a list is merged
 * into, the chain-placed directory a list exists to disown.
 */
export function claimedPaths(chunk: string): string[] {
  const named = chunk.split("—")[0]!;
  return [...named.matchAll(/`([^`]+)`/g)].map((m) => m[1]!);
}

// ---------- the harness-managed state claim ----------

/** The docs that teach a state root's layout, and must agree about it. */
export const STATE_SCANNED_DOCS = ["README.md", join("docs", "CHAIN-AUTHORING.md")];

/**
 * The line that opens a harness-managed-state claim, in either doc's
 * register: README's list header, the chain doc's inline bold run-in.
 */
const HARNESS_STATE_MARKER = /^\s*(?:\*\*)?Harness-managed state\b/;

/** The claim region for this pin's marker. */
export const stateRegion = (text: string): string[] | null =>
  regionLines(text, HARNESS_STATE_MARKER);

/**
 * A doc's path token as a state-root-relative name: the `.flume/` prefix
 * and any trailing separator dropped, and a trailing `<placeholder>`
 * segment — `<phase>`, `<entry-slug>`, `<timestamp>.jsonl` — dropped with
 * it, since what the runtime owns is the directory, not the names it generates
 * inside it.
 */
export function stateRootName(claim: string): string {
  const parts = claim
    .replace(/^\.flume\//, "")
    .split("/")
    .filter((s) => s !== "");
  while (parts.length > 0 && /^<.+>/.test(parts[parts.length - 1]!)) {
    parts.pop();
  }
  return parts.join("/");
}

/** `const NAME = "literal";` declarations in one module. */
function stringConsts(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of text.matchAll(/\bconst\s+(\w+)\s*=\s*"([^"]+)"\s*;/g)) {
    out.set(m[1]!, m[2]!);
  }
  return out;
}

/** `STATE_ROOT_NAMES`'s key → name map, read off its declaration. */
function stateRootNamesMap(): Map<string, string> {
  const block =
    /export const STATE_ROOT_NAMES = \{([\s\S]*?)\n\} as const;/.exec(
      readDoc("src", "paths.ts"),
    );
  const out = new Map<string, string>();
  if (!block) return out;
  for (const m of block[1]!.matchAll(/(\w+)\s*:\s*"([^"]+)"/g)) {
    out.set(m[1]!, m[2]!);
  }
  return out;
}

/**
 * The writer side: every name `src/` itself places directly under a state
 * root. Read off the real writers rather than a list kept here — each
 * `join(flumeDir, …)` with an argument this reader can resolve (a literal,
 * a `STATE_ROOT_NAMES` member, a module-local string const), plus the
 * default queue path, which is joined onto a state root by
 * `resolvePendingPath` rather than spelled at a `flumeDir` call site.
 *
 * An argument that does not resolve is skipped on purpose: `chain.friction`
 * is a chain-supplied name, which is exactly the category this pin exists
 * to keep out of a harness-managed list.
 */
export function namesSrcSpells(): string[] {
  const roots = stateRootNamesMap();
  const names = new Set<string>();
  for (const file of readdirSync(join(REPO_ROOT, "src")).filter((n) =>
    n.endsWith(".ts"),
  )) {
    const text = readDoc("src", file);
    const consts = stringConsts(text);
    for (const m of text.matchAll(
      /join\(\s*(?:this\.)?flumeDir\s*,\s*([^),]+?)\s*\)/g,
    )) {
      const arg = m[1]!;
      const literal = /^"([^"]+)"$/.exec(arg);
      const member = /^STATE_ROOT_NAMES\.(\w+)$/.exec(arg);
      const resolved = literal
        ? literal[1]!
        : member
          ? roots.get(member[1]!)
          : consts.get(arg);
      if (resolved) names.add(resolved);
    }
  }
  const pending = /export const DEFAULT_PENDING_REL = join\(([^)]*)\);/.exec(
    readDoc("src", "paths.ts"),
  );
  if (pending) {
    names.add(
      [...pending[1]!.matchAll(/"([^"]+)"/g)].map((m) => m[1]!).join("/"),
    );
  }
  return [...names];
}

// ---------- the job-seed ignore claim ----------

export const JOB_SEED_DOC = join("docs", "CHAIN-AUTHORING.md");
const RUNTIME_OWNS_MARKER = /^\s*(?:\*\*)?What the runtime still owns\b/;

/**
 * The bullet that names the merged entries — the one bullet in the region
 * that is about ignoring anything; its siblings pin `core.longpaths` and
 * baseline-commit the seed. Selected by what it says rather than by
 * position, so reordering the list does not silently point this pin at
 * `core.longpaths`.
 */
export function seedChunk(text: string): string {
  const region = regionLines(text, RUNTIME_OWNS_MARKER);
  expect(
    region,
    `${JOB_SEED_DOC} states no "What the runtime still owns" claim the scan can ` +
      "find — restore the marker, or this pin is blind",
  ).not.toBeNull();
  const bullets = claimChunks(region!).filter(
    (c) => /^-\s/.test(c) && /ignore/i.test(c),
  );
  expect(
    bullets,
    `${JOB_SEED_DOC}: the runtime-owned region holds no ignore-list bullet`,
  ).toHaveLength(1);
  return bullets[0]!;
}

// ---------- the worktree-base claim ----------

/** The two published surfaces that teach where a worktree lands. */
export const BASE_DOCS = ["README.md", join("docs", "CHAIN-AUTHORING.md")];

/**
 * A state root to resolve against. Never touched on disk — `worktreesBase`
 * is pure — and absolute, so an override probe below is comparable to it
 * without a second `resolve` on this side.
 */
export const DOC_CLAIM_FLUME_DIR = resolve("doc-claim-state-root");

/**
 * The resolution as a doc states it: one backticked
 * `<ENV> ?? join(flumeDir, "<segment>")` token. Both docs write the formula
 * in a single quoted expression, which is why this pin needs no markdown
 * region reader — the claim is the token.
 */
const FORMULA =
  /^([A-Z][A-Z0-9_]*)\s*\?\?\s*join\(\s*flumeDir\s*,\s*"([^"]+)"\s*\)$/;

/**
 * A per-entry worktree path template — the state root (spelled
 * `<flumeDir>`, or concretely as this repo's own `.flume`), the segments
 * the doc puts under it, and the entry placeholder that makes the token a
 * claim about *this* base rather than a sibling under the same root. The
 * placeholder anchor is what keeps README's state list — `.flume/awake/…`,
 * `.flume/loop.pid` and the rest — out of a scan about worktrees.
 */
const TEMPLATE =
  /^(?:<flumeDir>|<repoRoot>\/\.flume|\.flume)\/(.+?)\/<entry[\w-]*>\/?$/;

const backticked = (text: string): string[] =>
  [...text.matchAll(/`([^`\n]+)`/g)].map((m) => m[1]!);

/** Every `<ENV> ?? join(flumeDir, …)` formula the doc spells. */
export function formulaClaims(text: string): { env: string; segments: string }[] {
  return backticked(text).flatMap((tok) => {
    const m = FORMULA.exec(tok);
    return m ? [{ env: m[1]!, segments: m[2]! }] : [];
  });
}

/** Every per-entry template's segment path, e.g. `"worktrees"`. */
export function templateSegments(text: string): string[] {
  return backticked(text).flatMap((tok) => {
    const m = TEMPLATE.exec(tok);
    return m ? [m[1]!] : [];
  });
}

/** A doc's claimed base path, built from its own segments. */
const claimedBase = (segments: string): string =>
  join(DOC_CLAIM_FLUME_DIR, ...segments.split("/"));

/**
 * Every base a doc claims — the formula's default and each per-entry
 * template's — that is not the path the resolver actually builds.
 */
export function baseDisagreements(text: string): string[] {
  const real = worktreesBase(DOC_CLAIM_FLUME_DIR);
  return [
    ...formulaClaims(text).map((f) => f.segments),
    ...templateSegments(text),
  ].filter((segments) => claimedBase(segments) !== real);
}

// ---------- the `FlumePaths.flumeDir` children claim ----------

export const FLUME_API_PATH = join("src", "flumeApi.ts");
/**
 * The doc comment immediately above a field declaration — the block that
 * closes on the line before it. Returned as raw source lines so the
 * paragraph reader below is the only place markers are stripped.
 */
function fieldDocBlock(text: string, field: string): string[] | null {
  const lines = text.split("\n");
  const decl = lines.findIndex((l) =>
    new RegExp(`^\\s*${field}:\\s`).test(l),
  );
  if (decl === -1) return null;
  const end = decl - 1;
  if (end < 0 || !/\*\/\s*$/.test(lines[end]!)) return null;
  let start = end;
  while (start >= 0 && !/\/\*\*/.test(lines[start]!)) start--;
  return start < 0 ? null : lines.slice(start, end + 1);
}

/**
 * A doc block as reader-visible paragraphs: markers stripped, wrapped
 * lines rejoined, blank comment lines taken as the breaks they render as.
 * The paragraph is the unit here because the claim about children and the
 * pointer away from them are deliberately different paragraphs.
 */
function docParagraphs(block: string[]): string[] {
  const prose = block
    .join("\n")
    .replace(/\/\*\*/, "")
    .replace(/\*\/\s*$/, "")
    .split("\n")
    .map((l) => l.replace(/^\s*\*\s?/, "").trim());
  const out: string[][] = [];
  let cur: string[] = [];
  for (const line of prose) {
    if (line === "") {
      if (cur.length) out.push(cur);
      cur = [];
    } else cur.push(line);
  }
  if (cur.length) out.push(cur);
  return out.map((p) => p.join(" "));
}

const flumeDirBlock = (text: string): string[] =>
  fieldDocBlock(text, "flumeDir") ??
  (() => {
    throw new Error(
      `${FLUME_API_PATH}: no doc comment found above \`flumeDir\` — the reader ` +
        "lost its subject, and every claim below would pass blind",
    );
  })();

/** The comment's opening paragraph: the list of what the root holds. */
export const childrenClaim = (text: string): string =>
  docParagraphs(flumeDirBlock(text))[0] ?? "";

/** Everything the comment says, as one run — where a pointer may live. */
export const flumeDirWhole = (text: string): string =>
  docParagraphs(flumeDirBlock(text)).join(" ");
