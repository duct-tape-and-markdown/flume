import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { SPAWN_BUDGET_MS, runNodeStreams } from "./helpers/subprocess.ts";

const exec = promisify(execFile);

const SCRIPT = fileURLToPath(
  new URL("../scripts/build-changelog.mjs", import.meta.url),
);

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await exec("git", args, { cwd });
  return stdout.trim();
}

async function commit(
  cwd: string,
  rel: string,
  content: string,
  message: string,
): Promise<string> {
  const abs = join(cwd, rel);
  await mkdir(dirname(abs), { recursive: true });
  await writeFile(abs, content);
  await git(cwd, ["add", "--", rel]);
  await git(cwd, ["commit", "-q", "-m", message]);
  return git(cwd, ["rev-parse", "HEAD"]);
}

/**
 * Spawn the script against `cwd`; never throws on non-zero exit. The ambient
 * env, not the CLI suites' hermetic one: the script is git-driven and reads
 * no FLUME_* var.
 */
async function runChangelog(
  cwd: string,
): Promise<{ out: string; err: string; code: number }> {
  const { stdout, stderr, code } = await runNodeStreams(cwd, [SCRIPT]);
  return { out: stdout, err: stderr, code };
}

/**
 * The slice of a rendered draft the named subheading owns: from the heading
 * down to the next heading of any level, or to the end. Entry bodies are
 * indented two spaces, so a `#` inside one never reads as a heading.
 */
function subsection(out: string, heading: string): string {
  const start = out.indexOf(heading);
  if (start === -1) return "";
  const rest = out.slice(start + heading.length);
  const next = rest.search(/^#{1,6} /m);
  return next === -1 ? rest : rest.slice(0, next);
}

const breakingSubsection = (out: string) => subsection(out, "### Breaking");
const uncategorizedSubsection = (out: string) =>
  subsection(out, "### Uncategorized");

let repo: string;

beforeEach(async () => {
  repo = await mkdtemp(join(tmpdir(), "flume-changelog-repo-"));
  const opts = { cwd: repo };
  await exec("git", ["init", "-q"], opts);
  await exec("git", ["config", "user.email", "test@example.com"], opts);
  await exec("git", ["config", "user.name", "Test User"], opts);
  await exec("git", ["config", "commit.gpgsign", "false"], opts);
  await exec("git", ["config", "core.autocrlf", "false"], opts);
});

afterEach(async () => {
  await rm(repo, { recursive: true, force: true });
});

describe("build-changelog", () => {
  it("derives [Unreleased] content from the range since the last release tag, using build: commit subjects as entry tags and bodies as the why", async () => {
    await commit(repo, "CHANGELOG.md", "# Changelog\n", "seed");
    await git(repo, ["tag", "v1.0.0"]);

    await commit(
      repo,
      "src/foo.ts",
      "export const foo = 1;\n",
      "build: add foo helper (ADD-FOO-HELPER)\n\nfoo was missing, so callers hand-rolled it inline.",
    );

    const { out, code } = await runChangelog(repo);

    expect(code).toBe(0);
    expect(out).toContain("## [Unreleased]");
    expect(out).toContain("- add foo helper (ADD-FOO-HELPER)");
    expect(out).toContain("foo was missing, so callers hand-rolled it inline.");
  }, SPAWN_BUDGET_MS);

  it("resolves a tag history that stops short of CHANGELOG.md's latest recorded version via a defined fallback, not an assumption", async () => {
    // Tags stop at v0.6.2, but releases kept cutting past it (real-world
    // shape of this repo): a later "chore(release): cut 0.9.0" commit moves
    // CHANGELOG.md's heading forward with no matching tag. The stale tag
    // must not be treated as the boundary — it would replay the untagged
    // 0.7.0/0.8.0/0.9.0 history as unreleased.
    await commit(
      repo,
      "CHANGELOG.md",
      "# Changelog\n\n## [Unreleased]\n\n## [0.6.2]\n",
      "seed at 0.6.2",
    );
    await git(repo, ["tag", "v0.6.2"]);

    await commit(
      repo,
      "src/mid.ts",
      "// mid release work, already shipped in 0.9.0\n",
      "build: ship mid-release work (MID-RELEASE-WORK)",
    );
    await commit(
      repo,
      "CHANGELOG.md",
      "# Changelog\n\n## [Unreleased]\n\n## [0.9.0]\n\n## [0.6.2]\n",
      "chore(release): cut 0.9.0",
    );

    await commit(
      repo,
      "src/after.ts",
      "export const after = 1;\n",
      "build: add after-release feature (AFTER-RELEASE-FEATURE)",
    );

    const { out, code } = await runChangelog(repo);

    expect(code).toBe(0);
    expect(out).toContain("AFTER-RELEASE-FEATURE");
    expect(out).not.toContain("MID-RELEASE-WORK");
  }, SPAWN_BUDGET_MS);

  it("resolves the boundary from the semver tag fallback when CHANGELOG.md is absent entirely", async () => {
    // The other half of the narrowed catch: absence (`ENOENT`) is the one
    // read failure the tag fallback is scoped to — a repo that never
    // recorded a version. No CHANGELOG.md is ever written here.
    await commit(repo, "src/seed.ts", "export const seed = 1;\n", "seed");
    await git(repo, ["tag", "v1.0.0"]);
    await commit(
      repo,
      "src/after.ts",
      "export const after = 1;\n",
      "build: add after-tag feature (AFTER-TAG-FEATURE)",
    );

    const { out, code } = await runChangelog(repo);

    expect(code).toBe(0);
    expect(out).toContain("AFTER-TAG-FEATURE");
  }, SPAWN_BUDGET_MS);

  it("an unreadable CHANGELOG.md refuses instead of resolving the boundary from the tag fallback", async () => {
    await commit(repo, "src/seed.ts", "export const seed = 1;\n", "seed");
    await git(repo, ["tag", "v1.0.0"]);
    await commit(
      repo,
      "src/released.ts",
      "export const released = 1;\n",
      "build: ship released work (RELEASED-WORK)",
    );
    // A directory in place of CHANGELOG.md reproduces a non-ENOENT read
    // failure (EISDIR) without relying on permission bits a root-run test
    // could bypass. The tag fallback is scoped to a repo that never recorded
    // a version, so reading this as absence resolves the boundary to v1.0.0
    // and re-mines RELEASED-WORK as unreleased.
    await mkdir(join(repo, "CHANGELOG.md"));

    const { out, err, code } = await runChangelog(repo);

    expect(code).not.toBe(0);
    expect(out).not.toContain("[Unreleased]");
    expect(out).not.toContain("RELEASED-WORK");
    expect(err).toContain("CHANGELOG.md");
    expect(err).toContain("EISDIR");
  }, SPAWN_BUDGET_MS);

  it("a recorded CHANGELOG version whose boundary commit does not resolve refuses instead of falling through to the tag", async () => {
    await commit(repo, "src/seed.ts", "export const seed = 1;\n", "seed");
    await git(repo, ["tag", "v1.0.0"]);
    await commit(
      repo,
      "src/released.ts",
      "export const released = 1;\n",
      "build: ship released work (RELEASED-WORK)",
    );
    // A cut in progress: CHANGELOG.md records 0.9.0 in the working tree, but
    // no commit has introduced that heading yet, so `git log -S` over the
    // path finds nothing. Falling through would resolve the boundary to
    // v1.0.0 and re-mine the already-released RELEASED-WORK as unreleased.
    await writeFile(
      join(repo, "CHANGELOG.md"),
      "# Changelog\n\n## [Unreleased]\n\n## [0.9.0]\n",
    );

    const { out, err, code } = await runChangelog(repo);

    expect(code).not.toBe(0);
    expect(out).not.toContain("[Unreleased]");
    expect(out).not.toContain("RELEASED-WORK");
    expect(err).toContain("0.9.0");
    expect(err).toContain("CHANGELOG.md");
  }, SPAWN_BUDGET_MS);

  it("refuses loudly on a zero-commit range instead of emitting an empty [Unreleased] section", async () => {
    await commit(repo, "CHANGELOG.md", "# Changelog\n", "seed");
    await git(repo, ["tag", "v1.0.0"]);
    // No commits after the tag: nothing to changelog.

    const { out, err, code } = await runChangelog(repo);

    expect(code).not.toBe(0);
    expect(out).not.toContain("[Unreleased]");
    expect(err.toLowerCase()).toContain("no build:");
  }, SPAWN_BUDGET_MS);

  it("preserves the ### Breaking subheading convention for commits whose body marks a break", async () => {
    await commit(repo, "CHANGELOG.md", "# Changelog\n", "seed");
    await git(repo, ["tag", "v1.0.0"]);

    await commit(
      repo,
      "src/normal.ts",
      "export const normal = 1;\n",
      "build: add a normal feature (NORMAL-FEATURE)\n\nJust an ordinary addition.",
    );
    await commit(
      repo,
      "src/removed.ts",
      "// api surface changed\n",
      "build: drop the legacy export (LEGACY-EXPORT-DROP)\n\nBREAKING: `legacyExport` is removed; use `newExport` instead.",
    );

    const { out, code } = await runChangelog(repo);

    expect(code).toBe(0);
    const breakingIdx = out.indexOf("### Breaking");
    expect(breakingIdx).toBeGreaterThan(-1);
    expect(breakingSubsection(out)).toContain("LEGACY-EXPORT-DROP");
    expect(out.indexOf("### Breaking", breakingIdx + 1)).toBe(-1);
  }, SPAWN_BUDGET_MS);

  it("a non-breaking entry renders outside the ### Breaking subsection when a breaking entry is present", async () => {
    await commit(repo, "CHANGELOG.md", "# Changelog\n", "seed");
    await git(repo, ["tag", "v1.0.0"]);

    await commit(
      repo,
      "src/normal.ts",
      "export const normal = 1;\n",
      "build: add a normal feature (NORMAL-FEATURE)\n\nJust an ordinary addition.",
    );
    await commit(
      repo,
      "src/removed.ts",
      "// api surface changed\n",
      "build: drop the legacy export (LEGACY-EXPORT-DROP)\n\nBREAKING: `legacyExport` is removed; use `newExport` instead.",
    );

    const { out, code } = await runChangelog(repo);

    expect(code).toBe(0);
    const breaking = breakingSubsection(out);
    // Vacuity: the subsection judged below must be the one holding the break.
    expect(breaking).toContain("LEGACY-EXPORT-DROP");
    expect(out).toContain("- add a normal feature (NORMAL-FEATURE)");
    expect(breaking).not.toContain("NORMAL-FEATURE");
    expect(breaking).not.toContain("Just an ordinary addition.");
  }, SPAWN_BUDGET_MS);

  it("the mined draft renders every non-breaking entry under an ### Uncategorized subheading", async () => {
    await commit(repo, "CHANGELOG.md", "# Changelog\n", "seed");
    await git(repo, ["tag", "v1.0.0"]);

    await commit(
      repo,
      "src/normal.ts",
      "export const normal = 1;\n",
      "build: add a normal feature (NORMAL-FEATURE)\n\nJust an ordinary addition.",
    );
    await commit(
      repo,
      "src/removed.ts",
      "// api surface changed\n",
      "build: drop the legacy export (LEGACY-EXPORT-DROP)\n\nBREAKING: `legacyExport` is removed; use `newExport` instead.",
    );
    await commit(
      repo,
      "src/other.ts",
      "export const other = 1;\n",
      "build: add another feature (ANOTHER-FEATURE)\n\nA second ordinary addition.",
    );

    const { out, code } = await runChangelog(repo);

    expect(code).toBe(0);
    const uncategorized = uncategorizedSubsection(out);
    // Vacuity: the draft judged below holds both kinds, so an empty
    // non-breaking bucket cannot pass this as "every entry".
    expect(out).toContain("LEGACY-EXPORT-DROP");
    const nonBreaking = ["NORMAL-FEATURE", "ANOTHER-FEATURE"];
    expect(nonBreaking.length).toBeGreaterThan(0);
    for (const tag of nonBreaking) {
      expect(out).toContain(tag);
      expect(uncategorized).toContain(tag);
    }
    expect(uncategorized).not.toContain("LEGACY-EXPORT-DROP");
  }, SPAWN_BUDGET_MS);

  it("the mined draft renders ### Breaking ahead of ### Uncategorized", async () => {
    await commit(repo, "CHANGELOG.md", "# Changelog\n", "seed");
    await git(repo, ["tag", "v1.0.0"]);

    // Committed non-breaking-first: the draft's order is the renderer's
    // choice, not the history's.
    await commit(
      repo,
      "src/normal.ts",
      "export const normal = 1;\n",
      "build: add a normal feature (NORMAL-FEATURE)\n\nJust an ordinary addition.",
    );
    await commit(
      repo,
      "src/removed.ts",
      "// api surface changed\n",
      "build: drop the legacy export (LEGACY-EXPORT-DROP)\n\nBREAKING: `legacyExport` is removed; use `newExport` instead.",
    );

    const { out, code } = await runChangelog(repo);

    expect(code).toBe(0);
    const breakingIdx = out.indexOf("### Breaking");
    const uncategorizedIdx = out.indexOf("### Uncategorized");
    expect(breakingIdx).toBeGreaterThan(-1);
    expect(uncategorizedIdx).toBeGreaterThan(-1);
    expect(breakingIdx).toBeLessThan(uncategorizedIdx);
    expect(out.indexOf("## [Unreleased]")).toBeLessThan(breakingIdx);
  }, SPAWN_BUDGET_MS);

  it("a draft with no breaking entry renders ### Uncategorized and no ### Breaking heading", async () => {
    await commit(repo, "CHANGELOG.md", "# Changelog\n", "seed");
    await git(repo, ["tag", "v1.0.0"]);

    await commit(
      repo,
      "src/normal.ts",
      "export const normal = 1;\n",
      "build: add a normal feature (NORMAL-FEATURE)\n\nJust an ordinary addition.",
    );

    const { out, code } = await runChangelog(repo);

    expect(code).toBe(0);
    expect(uncategorizedSubsection(out)).toContain("NORMAL-FEATURE");
    expect(out).not.toContain("### Breaking");
  }, SPAWN_BUDGET_MS);

  it("a draft whose entries are all breaking still renders the ### Breaking subheading", async () => {
    await commit(repo, "CHANGELOG.md", "# Changelog\n", "seed");
    await git(repo, ["tag", "v1.0.0"]);

    await commit(
      repo,
      "src/first.ts",
      "// api surface changed\n",
      "build: rename the first export (FIRST-BREAK)\n\nBREAKING: `first` is now `firstThing`.",
    );
    await commit(
      repo,
      "src/second.ts",
      "// api surface changed\n",
      "build: drop the second export (SECOND-BREAK)\n\nBREAKING: `second` is removed.",
    );

    const { out, code } = await runChangelog(repo);

    expect(code).toBe(0);
    expect(out).toContain("### Breaking");
    const breaking = breakingSubsection(out);
    expect(breaking).toContain("FIRST-BREAK");
    expect(breaking).toContain("SECOND-BREAK");
    // The empty bucket is spelled, not inherited: no entry is uncategorized,
    // so the second subheading does not render.
    expect(out).not.toContain("### Uncategorized");
  }, SPAWN_BUDGET_MS);

  it("strips Co-Authored-By trailers from the mined body", async () => {
    await commit(repo, "CHANGELOG.md", "# Changelog\n", "seed");
    await git(repo, ["tag", "v1.0.0"]);

    await commit(
      repo,
      "src/foo.ts",
      "export const foo = 1;\n",
      "build: add foo (ADD-FOO)\n\nThe why.\n\nCo-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>",
    );

    const { out, code } = await runChangelog(repo);

    expect(code).toBe(0);
    expect(out).toContain("The why.");
    expect(out).not.toContain("Co-Authored-By");
  }, SPAWN_BUDGET_MS);

  it("surfaces a build: subject matching none of the 3 declared tag shapes loudly instead of dropping it silently", async () => {
    await commit(repo, "CHANGELOG.md", "# Changelog\n", "seed");
    await git(repo, ["tag", "v1.0.0"]);

    await commit(
      repo,
      "src/kept.ts",
      "export const kept = 1;\n",
      "build: add kept feature (KEPT-FEATURE)",
    );
    // "build(...)" whose tag is lowercase matches none of the 3 declared
    // shapes (paren-tag requires an uppercase tag; trailing-tag and plain
    // both require a "build:" prefix, not "build(").
    const malformedSha = await commit(
      repo,
      "src/malformed.ts",
      "export const malformed = 1;\n",
      "build(lowercase-tag): do something",
    );

    const { out, err, code } = await runChangelog(repo);

    expect(code).toBe(0);
    expect(out).toContain("KEPT-FEATURE");
    expect(out).not.toContain("do something");
    expect(err).toContain(malformedSha.slice(0, 12));
    expect(err).toContain("build(lowercase-tag): do something");
  }, SPAWN_BUDGET_MS);

  it("rejects a mismatched bracket pair such as (TAG] instead of accepting it as tag TAG", async () => {
    await commit(repo, "CHANGELOG.md", "# Changelog\n", "seed");
    await git(repo, ["tag", "v1.0.0"]);

    await commit(
      repo,
      "src/mismatched.ts",
      "export const mismatched = 1;\n",
      "build: fix the widget (MISMATCHED-TAG]",
    );

    const { out, code } = await runChangelog(repo);

    expect(code).toBe(0);
    // The subject still surfaces as an entry (falls back to the untagged
    // shape) rather than vanishing, but the mismatched pair must not be
    // parsed out as a clean tag.
    expect(out).toContain("fix the widget (MISMATCHED-TAG]");
    expect(out).not.toContain("- fix the widget (MISMATCHED-TAG)");
  }, SPAWN_BUDGET_MS);

  it("ignores non-build: commits (plan:, chore:) when mining entries", async () => {
    await commit(repo, "CHANGELOG.md", "# Changelog\n", "seed");
    await git(repo, ["tag", "v1.0.0"]);

    await commit(repo, ".flume/plan/state.md", "state\n", "plan: derive queue");
    await commit(repo, ".flume/inbox.md", "", "chore(flume): drain inbox");
    await commit(
      repo,
      "src/shipped.ts",
      "export const shipped = 1;\n",
      "build: ship shipped feature (SHIPPED-FEATURE)",
    );

    const { out, code } = await runChangelog(repo);

    expect(code).toBe(0);
    expect(out).toContain("SHIPPED-FEATURE");
    expect(out).not.toContain("derive queue");
    expect(out).not.toContain("drain inbox");
  }, SPAWN_BUDGET_MS);
});
