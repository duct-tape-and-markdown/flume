#!/usr/bin/env node
/**
 * scripts/build-changelog.mjs — mine a `## [Unreleased]` draft from git
 * history since the last release (spec/cli.md "Versioning policy": the
 * changelog is a release artifact mined from git history at the cut, not a
 * per-commit obligation).
 *
 * Prints the draft to stdout for a human to fold into CHANGELOG.md at cut
 * time. Never writes CHANGELOG.md itself — the mined text is raw material
 * (commit subject + body), not the polished record a human curates.
 *
 * Boundary resolution: the last release is CHANGELOG.md's own top-most
 * `## [X.Y.Z]` heading (Keep a Changelog orders newest-first), resolved to
 * the commit that introduced that heading text via `git log -S`. This is
 * deliberately not "the latest git tag" — a repo can keep cutting releases
 * (a `chore(release): cut X.Y.Z` commit updating CHANGELOG.md and
 * package.json) without a corresponding tag ever being pushed, and treating
 * a stale tag as the boundary would re-mine already-released commits as
 * unreleased. A semver-shaped tag (`vX.Y.Z`) is the fallback for a project
 * that has never recorded a version in CHANGELOG.md at all — absence is the
 * whole of that trigger, so every other outcome refuses rather than falling
 * through to a tag that may lag the last cut: a non-ENOENT read failure, and
 * a recorded version whose introducing commit `git log -S` cannot find.
 *
 * Entry source: `build:` commits only (`build: <desc> (TAG)`,
 * `build: <desc> [TAG]`, or `build(TAG): <desc>`) — the per-pending-entry
 * shipping unit (CLAUDE.md "Build phase commits per pending entry ... after
 * green validation"). plan:/chore:/spec: commits are process bookkeeping,
 * not user-facing change.
 *
 * Breaking marker: a commit body line starting with `BREAKING:` routes the
 * entry under `### Breaking`; everything else lands under `### Uncategorized`
 * (spec/cli.md "Versioning policy"). `### Breaking` leads so the draft is
 * ordered as the curated changelog is, and `### Uncategorized` is the
 * curating human's cue for what is still unsorted.
 */

import { execFileSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const FIELD_SEP = "\x1f";
const RECORD_SEP = "\x1e";
const LOG_FORMAT = `%H${FIELD_SEP}%s${FIELD_SEP}%b${RECORD_SEP}`;

const BUILD_PAREN_TAG = /^build\(([A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*)\):\s*(.+)$/;
// Bracket pairs must match — `(TAG]` is not a valid tag delimiter, so the
// two shapes are separate alternatives rather than independent open/close
// character classes (which would accept mismatched pairs like `(TAG]`).
const BUILD_TRAILING_TAG =
  /^build:\s*(.+?)\s*(?:\(([A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*)\)|\[([A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*)\])\s*$/;
const BUILD_PLAIN = /^build:\s*(.+)$/;
// Subjects that read as an attempted build: entry — used only to decide
// whether a parse failure is loud-worthy (a malformed tag attempt) versus
// an unrelated commit that legitimately isn't a build: entry.
const BUILD_SUBJECT_ATTEMPT = /^build[:(]/;

/**
 * Run git in `cwd` and return its stdout.
 *
 * `maxBuffer: Infinity`, not a raised number. The read this helper exists for
 * is the log over `<last release>..HEAD` — and, with no prior release
 * recorded, over the whole of history — so its size grows with the repository
 * and never shrinks, which makes the inherited cap
 * (`.claude/rules/platform-facts.md`, "Node caps a captured child stream at
 * 1 MiB, and reports the overrun as a spawn failure") not a sizing question:
 * any finite replacement is that same failure rescheduled for a later cut.
 * What bounds the read instead is the process's own memory, which fails
 * loudly rather than handing back a truncated log for a human to curate a
 * release from (`.claude/rules/engineering.md`, "Loud or nothing").
 */
function git(cwd, args) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    maxBuffer: Infinity,
  });
}

/**
 * Resolve the commit boundary for "since the last release", or `null` when no
 * prior release is recorded. Throws when CHANGELOG.md records a version the
 * boundary cannot be resolved from, rather than answering it from a tag.
 */
export function resolveLastRelease(root) {
  const changelogPath = join(root, "CHANGELOG.md");
  let changelogVersion = null;
  try {
    const text = readFileSync(changelogPath, "utf8");
    const m = text.match(/^## \[(\d+\.\d+\.\d+)\]/m);
    if (m) changelogVersion = m[1];
  } catch (err) {
    // Absent (`ENOENT`) is the only reading the tag fallback is scoped to:
    // a repo that never recorded a version (doc block above). Any other
    // read failure leaves the boundary unresolved, and falling through
    // would answer it from a tag that may lag the last cut — silently
    // re-mining already-released `build:` commits under `## [Unreleased]`
    // for a human to curate (`.claude/rules/engineering.md`, "Loud or
    // nothing").
    if (err.code !== "ENOENT") {
      throw new Error(
        `${changelogPath} could not be read (${err.code}): ${err.message}`,
        { cause: err },
      );
    }
  }

  if (changelogVersion) {
    const needle = `## [${changelogVersion}]`;
    const out = git(root, [
      "log",
      "--reverse",
      "--format=%H",
      "-S",
      needle,
      "--",
      "CHANGELOG.md",
    ]);
    const sha = out.split("\n").find((line) => line.trim() !== "");
    // A recorded version is the boundary, resolvable or not. Reaching the tag
    // fallback from here would answer a *failed* resolution with a tag that
    // may lag the last cut — the same wrong draft the non-ENOENT refusal
    // above blocks, by the other door (`.claude/rules/engineering.md`, "Loud
    // or nothing"). The shape that gets here: a cut in progress, where
    // CHANGELOG.md carries the new heading in the working tree but no commit
    // has introduced it yet.
    if (!sha) {
      throw new Error(
        `CHANGELOG.md records version ${changelogVersion}, but no commit introducing '${needle}' to CHANGELOG.md was found — the release boundary is unresolved`,
      );
    }
    return sha.trim();
  }

  const tags = git(root, ["tag", "--list"])
    .split("\n")
    .map((t) => t.trim())
    .filter((t) => /^v\d+\.\d+\.\d+$/.test(t));
  if (tags.length > 0) {
    const latest = tags.sort(compareSemverTags).at(-1);
    return git(root, ["rev-list", "-n", "1", latest]).trim();
  }

  return null;
}

function compareSemverTags(a, b) {
  const pa = a.slice(1).split(".").map(Number);
  const pb = b.slice(1).split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function parseCommits(raw) {
  return raw
    .split(RECORD_SEP)
    .map((rec) => rec.replace(/^\n/, ""))
    .filter((rec) => rec.trim() !== "")
    .map((rec) => {
      const [sha, subject = "", body = ""] = rec.split(FIELD_SEP);
      return { sha, subject, body };
    });
}

function parseBuildSubject(subject) {
  let m = BUILD_PAREN_TAG.exec(subject);
  if (m) return { tag: m[1], desc: m[2].trim() };

  m = BUILD_TRAILING_TAG.exec(subject);
  if (m) return { tag: m[2] ?? m[3], desc: m[1].trim() };

  m = BUILD_PLAIN.exec(subject);
  if (m) return { tag: null, desc: m[1].trim() };

  return null;
}

function cleanBody(body) {
  const lines = body.split(/\r?\n/);
  // Trailing blank lines and trailing Co-Authored-By trailers interleave
  // (git appends a final newline after the last trailer), so strip both
  // from the end until neither pattern removes anything more.
  let shrank = true;
  while (shrank) {
    shrank = false;
    while (lines.length > 0 && lines.at(-1).trim() === "") {
      lines.pop();
      shrank = true;
    }
    while (lines.length > 0 && /^co-authored-by:/i.test(lines.at(-1).trim())) {
      lines.pop();
      shrank = true;
    }
  }
  while (lines.length > 0 && lines[0].trim() === "") lines.shift();
  return lines.join("\n");
}

function indent(text, prefix) {
  return text
    .split("\n")
    .map((line) => (line.length > 0 ? prefix + line : ""))
    .join("\n");
}

function formatEntry(desc, tag, body) {
  const header = tag ? `- ${desc} (${tag})` : `- ${desc}`;
  return body ? `${header}\n\n${indent(body, "  ")}` : header;
}

/** Derive `## [Unreleased]` entries from a `sinceSha..HEAD`-shaped commit range (or the full history when `sinceSha` is `null`). */
export function deriveEntries(root, sinceSha) {
  const range = sinceSha ? `${sinceSha}..HEAD` : "HEAD";
  const raw = git(root, ["log", "--reverse", `--format=${LOG_FORMAT}`, range]);
  const commits = parseCommits(raw);

  const entries = [];
  const warnings = [];
  for (const commit of commits) {
    const parsed = parseBuildSubject(commit.subject);
    if (!parsed) {
      if (BUILD_SUBJECT_ATTEMPT.test(commit.subject)) {
        warnings.push(
          `${commit.sha.slice(0, 12)} matches no declared tag shape, dropped from draft: ${commit.subject}`,
        );
      }
      continue;
    }
    const body = cleanBody(commit.body);
    entries.push({
      breaking: /^BREAKING:/im.test(body),
      text: formatEntry(parsed.desc, parsed.tag, body),
    });
  }
  return { range, entries, warnings };
}

export function renderSection(entries) {
  const breaking = entries.filter((e) => e.breaking);
  const rest = entries.filter((e) => !e.breaking);

  // `### Breaking` leads and `### Uncategorized` closes it: a markdown
  // subheading owns every line down to the next heading, so the second
  // heading is what bounds the first. A heading renders iff its bucket is
  // non-empty — a draft with one kind of entry carries one subheading.
  const blocks = ["## [Unreleased]"];
  if (breaking.length > 0) {
    blocks.push("### Breaking");
    blocks.push(breaking.map((e) => e.text).join("\n\n"));
  }
  if (rest.length > 0) {
    blocks.push("### Uncategorized");
    blocks.push(rest.map((e) => e.text).join("\n\n"));
  }
  return blocks.join("\n\n") + "\n";
}

function fail(message) {
  process.stderr.write(`[build-changelog] ${message}\n`);
  process.exitCode = 1;
}

function main() {
  const cwd = process.cwd();
  let root;
  try {
    root = git(cwd, ["rev-parse", "--show-toplevel"]).trim();
  } catch (err) {
    fail(`not a git repository (${cwd}): ${err.message}`);
    return;
  }

  let sinceSha;
  try {
    sinceSha = resolveLastRelease(root);
  } catch (err) {
    fail(`could not resolve the last release boundary: ${err.message}`);
    return;
  }

  // The same refusal the boundary resolution above gets: `deriveEntries`
  // shells out to git, so every way that read can fail — an unresolvable
  // range, a repository with no commits yet, an unreadable object store —
  // arrives here as a throw. Left uncaught it exits over a raw node stack
  // with no statement of what the tool was doing, which is a detected failure
  // reported as a crash (`.claude/rules/engineering.md`, "Loud or nothing").
  let derived;
  try {
    derived = deriveEntries(root, sinceSha);
  } catch (err) {
    fail(`could not derive entries for the draft: ${err.message}`);
    return;
  }
  const { range, entries, warnings } = derived;

  for (const warning of warnings) {
    process.stderr.write(`[build-changelog] ${warning}\n`);
  }

  if (entries.length === 0) {
    fail(
      `no build: commits found in range '${range}' — nothing to changelog. ` +
        (sinceSha
          ? `Last release resolved to ${sinceSha.slice(0, 12)}.`
          : "No prior release found (no CHANGELOG.md version heading, no vX.Y.Z tag)."),
    );
    return;
  }

  process.stdout.write(renderSection(entries));
}

/**
 * Direct-invocation guard: compare `import.meta.url` against
 * `process.argv[1]` resolved through symlinks, so importing this module for
 * its named exports runs no side effect — only running it as a script does.
 * The resolve is what lets a checkout reached through a link or junction
 * still match: node resolves the main entry's URL through links, while
 * `argv[1]` keeps the invoked path verbatim.
 *
 * This is deliberately shallower than the CLI's own entry check
 * (`onDiskIdentity`, `src/cli.ts`), which namespaces its argument, spends the
 * native binding rather than the JS one, and folds the answer back through
 * `plainPath` (`src/paths.ts`). The divergence is declared here, not an
 * oversight, on two counts:
 *
 * - Those three moves all exist for win32's namespaced alphabet, and this
 *   guard never enters it. It hands `realpathSync` exactly the `argv[1]` a
 *   shell or `pnpm run changelog` supplied and never a `\\?\` path of its
 *   own making, so the JS form is never given the namespaced drive root node
 *   22 throws over, and no answer can come back prefixed that was not passed
 *   in prefixed (`.claude/rules/platform-facts.md`, "realpathSync keeps the
 *   \\?\ prefix only where nothing resolved"). Both sides of the comparison
 *   are already in one alphabet, so there is no fold to spend — on the
 *   resolving leg or on the catch leg's raw path.
 * - Sharing the sibling would not be the one-line import it looks like. This
 *   is a `.mjs` that bare `node` runs, with no TS loader in front of it, so
 *   reaching `src/cli.ts` from here means either a built `dist/` or running
 *   the release tool under tsx — a build-order dependency bought for a
 *   difference that is inert at this call site.
 */
function isDirectInvocation() {
  const invoked = process.argv[1];
  if (!invoked) return false;
  let real;
  try {
    real = realpathSync(invoked);
  } catch {
    real = invoked;
  }
  return import.meta.url === pathToFileURL(real).href;
}

if (isDirectInvocation()) {
  main();
}
