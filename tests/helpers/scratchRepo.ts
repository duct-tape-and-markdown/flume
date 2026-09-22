/**
 * A seeded scratch git repository a spawned CLI can be a cwd of: a
 * {@link mkFixtureRoot} root (so bay discovery stops at the fixture rather
 * than at whatever `.flume` sits above the host temp dir), `git init` on a
 * caller-named branch, and one commit.
 *
 * One home for a fixture five suites spelled five times
 * (`.claude/rules/engineering.md`, *A module is one job*): a CLI verb that
 * refuses on a detached HEAD, or that keys a tip claim on the ref HEAD names,
 * needs a real repo on a named branch before it reaches the arm under test,
 * and every suite driving one hand-rolled the same seven git calls.
 *
 * `prefix` is the caller's, so a fixture that outlives its test still names
 * the suite that made it.
 *
 * Not *.test.ts, so neither vitest lane collects it as a suite of its own.
 */

import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { mkFixtureRoot } from "./fixtureRoot.ts";
import { exec } from "./subprocess.ts";

/** A scratch repository and the removal that takes it down. */
export interface ScratchRepo {
  /** The repository root — a CLI cwd, and the bay discovery stops at. */
  readonly dir: string;
  readonly cleanup: () => Promise<void>;
}

/**
 * Seed a scratch repository on `branch`. The engine has no opinion on branch
 * names — a caller runs on whatever branch it asks for.
 */
export async function makeScratchRepo(
  prefix: string,
  branch: string,
): Promise<ScratchRepo> {
  const dir = await mkFixtureRoot(prefix);
  const opts = { cwd: dir };
  await exec("git", ["init", "-q", "-b", branch], opts);
  await exec("git", ["config", "user.email", "test@example.com"], opts);
  await exec("git", ["config", "user.name", "Test User"], opts);
  await exec("git", ["config", "commit.gpgsign", "false"], opts);
  await writeFile(join(dir, "README.md"), "seed\n");
  await exec("git", ["add", "."], opts);
  await exec("git", ["commit", "-q", "-m", "seed"], opts);
  return { dir, cleanup: () => rm(dir, { recursive: true, force: true }) };
}
