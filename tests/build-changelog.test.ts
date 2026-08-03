import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

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

/** Spawn the script against `cwd`; never throws on non-zero exit. */
async function runChangelog(
  cwd: string,
): Promise<{ out: string; err: string; code: number }> {
  try {
    const { stdout, stderr } = await exec(process.execPath, [SCRIPT], {
      cwd,
    });
    return { out: stdout, err: stderr, code: 0 };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; code?: number };
    return { out: e.stdout ?? "", err: e.stderr ?? "", code: e.code ?? 1 };
  }
}

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
  });

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
  });

  it("refuses loudly on a zero-commit range instead of emitting an empty [Unreleased] section", async () => {
    await commit(repo, "CHANGELOG.md", "# Changelog\n", "seed");
    await git(repo, ["tag", "v1.0.0"]);
    // No commits after the tag: nothing to changelog.

    const { out, err, code } = await runChangelog(repo);

    expect(code).not.toBe(0);
    expect(out).not.toContain("[Unreleased]");
    expect(err.toLowerCase()).toContain("no build:");
  });

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
    const legacyIdx = out.indexOf("LEGACY-EXPORT-DROP");
    const normalIdx = out.indexOf("NORMAL-FEATURE");

    expect(breakingIdx).toBeGreaterThan(-1);
    expect(legacyIdx).toBeGreaterThan(breakingIdx);
    // The non-breaking entry must not itself fall under ### Breaking.
    expect(normalIdx).toBeGreaterThan(-1);
    expect(out.indexOf("### Breaking", breakingIdx + 1)).toBe(-1);
  });

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
  });

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
  });

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
  });

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
  });
});
