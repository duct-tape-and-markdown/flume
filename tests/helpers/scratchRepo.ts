/**
 * A seeded scratch git repository: `git init` on a caller-named branch, the
 * identity a commit needs, and one commit — either into a directory the
 * caller already has ({@link commitInto}) or into a {@link mkFixtureRoot}
 * root this module makes ({@link makeScratchRepo}, whose root owns its own
 * bay, so discovery stops at the fixture rather than at whatever `.flume`
 * sits above the host temp dir).
 *
 * One home for a fixture five suites spelled five times
 * (`.claude/rules/engineering.md`, *A module is one job*): a CLI verb that
 * refuses on a detached HEAD, or that keys a tip claim on the ref HEAD names,
 * needs a real repo on a named branch before it reaches the arm under test,
 * and every suite driving one hand-rolled the same seven git calls. The two
 * exports are one sequence with two callers, differing only in who owns the
 * directory and in what each hands back.
 *
 * `prefix` is the caller's, so a fixture that outlives its test still names
 * the suite that made it.
 *
 * Not *.test.ts, so neither vitest lane collects it as a suite of its own.
 */

import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { mkFixtureRoot } from "./fixtureRoot.ts";
import { exec, gitOut } from "./subprocess.ts";

/** A scratch repository and the removal that takes it down. */
export interface ScratchRepo {
  /** The repository root — a CLI cwd, and the bay discovery stops at. */
  readonly dir: string;
  readonly cleanup: () => Promise<void>;
}

/** The branch a caller that has no opinion about one gets. */
const DEFAULT_BRANCH = "main";

/**
 * Seed `dir` — a directory the caller already made — as a repository on
 * `branch` carrying one commit of `files`, and return the tip it committed.
 *
 * For the suites whose subject is what something *writes into* a repository:
 * a fixture that planted its own bay would already be adopted, and the tip
 * comes back so a case compares what a writer stamped against the sha git
 * reports rather than against one the writer reported about itself.
 */
export async function commitInto(
  dir: string,
  files: Record<string, string>,
  branch: string = DEFAULT_BRANCH,
): Promise<string> {
  const opts = { cwd: dir };
  await exec("git", ["init", "-q", "-b", branch], opts);
  await exec("git", ["config", "user.email", "test@example.com"], opts);
  await exec("git", ["config", "user.name", "Test User"], opts);
  await exec("git", ["config", "commit.gpgsign", "false"], opts);
  for (const [rel, body] of Object.entries(files)) {
    const path = join(dir, ...rel.split("/"));
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, body, "utf8");
  }
  await exec("git", ["add", "-A"], opts);
  await exec("git", ["commit", "-q", "-m", "seed"], opts);
  return (await gitOut(dir, ["rev-parse", "HEAD"])).trim();
}

/**
 * Seed a scratch repository on `branch` in a fixture root of this module's
 * making. The engine has no opinion on branch names — a caller runs on
 * whatever branch it asks for.
 */
export async function makeScratchRepo(
  prefix: string,
  branch: string,
): Promise<ScratchRepo> {
  const dir = await mkFixtureRoot(prefix);
  await commitInto(dir, { "README.md": "seed\n" }, branch);
  return { dir, cleanup: () => rm(dir, { recursive: true, force: true }) };
}
