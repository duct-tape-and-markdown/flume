/**
 * The fixture-rooting idiom's own suite: the temp roots every temp-repo suite
 * composes its paths from, held to the spelling git reports for them.
 *
 * A fixture root is one side of a seam — the suites below it compare
 * `join`-composed paths against paths git emitted (a worktree registry entry,
 * `rev-parse --show-toplevel`, a name-only line). Naming the root by the
 * spelling `tmpdir()` happened to carry re-authors git's vocabulary in the
 * tester's hand, and the two sides then disagree about one directory
 * (`.claude/rules/engineering.md`, *A seam gate reads what the real writer
 * wrote*).
 *
 * Driven through a link this suite plants itself, because the defect is
 * invisible on a host whose temp dir is already canonical — `/tmp` on most
 * Linux boxes — and is exactly what the other lanes meet: macOS reaches
 * `/private/var/folders/…` as `/var/folders/…`, and the Windows runner reaches
 * `C:\Users\runneradmin\…` as the 8.3 short name `C:\Users\RUNNER~1\…`.
 */

import { mkdir, realpath, rm, symlink } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { readWorktreeRegistry } from "../src/worktrees.ts";

import { makeFixture } from "./helpers/dispatcherFixture.ts";
import { SPAWN_BUDGET_MS, gitOut, mkTempDir } from "./helpers/subprocess.ts";

// This file starts processes, so it declares the lane's one budget — cases
// and hooks alike — once here rather than inheriting the runner's default
// (`SPAWN_BUDGET_MS`, `tests/helpers/subprocess.ts`).
vi.setConfig({ testTimeout: SPAWN_BUDGET_MS, hookTimeout: SPAWN_BUDGET_MS });

describe("a temp fixture root speaks git's spelling of itself", () => {
  it("a fixture repo root is the path git reports for it, not the spelling the temp dir was named by", async () => {
    const scratch = await mkTempDir("flume-fixture-canon-");
    try {
      // The host's temp dir stands in for a canonical root; `link` is the
      // indirect spelling of it the fixture is handed. `"junction"` is
      // ignored off win32, and is what win32 creates without elevation.
      const canonical = join(scratch, "bay");
      await mkdir(canonical);
      const link = join(scratch, "link");
      await symlink(canonical, link, "junction");

      // Non-vacuity: the two spellings really differ on this host, so the
      // assertions below have something to tell apart. A host that resolved
      // the link at creation would otherwise pass them over nothing.
      expect(await realpath(link)).toBe(canonical);
      expect(link).not.toBe(canonical);

      const fx = await makeFixture(link);
      try {
        // The fixture was rooted under the indirect spelling, and still
        // reports the direct one.
        expect(dirname(fx.repo)).toBe(canonical);

        // `resolve` folds git's separator back to the host's: git prints its
        // paths forward-slashed on win32 too.
        const top = await gitOut(fx.repo, ["rev-parse", "--show-toplevel"]);
        expect(resolve(top)).toBe(fx.repo);

        // The same disagreement as the registry sees it — every worktree
        // verdict in `Dispatcher.test.ts` and `worktrees.test.ts` filters or
        // asserts membership by exact match against a path composed from
        // `fx.repo`, so a root git does not spell this way drops the primary
        // checkout out of its own registry.
        const registry = await readWorktreeRegistry(fx.repo);
        if (!registry.read) {
          throw new Error(`worktree registry unreadable: ${registry.reason}`);
        }
        expect([...registry.paths]).toContain(fx.repo);
      } finally {
        await fx.cleanup();
      }
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  });
});
