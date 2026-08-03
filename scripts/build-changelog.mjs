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
 * that has never recorded a version in CHANGELOG.md at all.
 *
 * Entry source: `build:` commits only (`build: <desc> (TAG)`,
 * `build: <desc> [TAG]`, or `build(TAG): <desc>`) — the per-pending-entry
 * shipping unit (CLAUDE.md "Build phase commits per pending entry ... after
 * green validation"). plan:/chore:/spec: commits are process bookkeeping,
 * not user-facing change.
 *
 * Breaking marker: a commit body line starting with `BREAKING:` routes the
 * entry under `### Breaking` instead of the flat list (spec/cli.md
 * "Versioning policy": "Each public-API breaking change lands under a
 * `### Breaking` subheading").
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

function git(cwd, args) {
  return execFileSync("git", args, { cwd, encoding: "utf8" });
}

/** Resolve the commit boundary for "since the last release", or `null` when no prior release is recorded. */
export function resolveLastRelease(root) {
  let changelogVersion = null;
  try {
    const text = readFileSync(join(root, "CHANGELOG.md"), "utf8");
    const m = text.match(/^## \[(\d+\.\d+\.\d+)\]/m);
    if (m) changelogVersion = m[1];
  } catch {
    changelogVersion = null;
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
    if (sha) return sha.trim();
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

  const blocks = ["## [Unreleased]"];
  if (breaking.length > 0) {
    blocks.push("### Breaking");
    blocks.push(breaking.map((e) => e.text).join("\n\n"));
  }
  if (rest.length > 0) {
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

  const sinceSha = resolveLastRelease(root);
  const { range, entries, warnings } = deriveEntries(root, sinceSha);

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
 * Direct-invocation guard (spec/cli.md "Direct invocation is detected by
 * realpath"): compare `import.meta.url` against `process.argv[1]` resolved
 * through symlinks, so importing this module for its named exports runs no
 * side effect — only running it as a script does.
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
