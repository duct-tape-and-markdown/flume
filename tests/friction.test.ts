/**
 * The friction module's own surface: the count line every status surface
 * prints, and the teardown harvest that fills the dir it counts.
 *
 * The round-trip below is an agreement gate (`.claude/rules/engineering.md`,
 * *A seam gate reads what the real writer wrote*): the real
 * `harvestFriction` deposits into the primary dir and the real
 * `frictionCountLine` counts what landed there. The two resolve
 * `chain.friction` against different roots — a worktree mirror on the write
 * side, the caller's state root on the read side — so a one-sided change to
 * either resolution shows up here as a count that disagrees with the files
 * on disk, rather than as a status line that silently reads zero while notes
 * pile up.
 *
 * The dispatcher's own end-to-end friction behavior (which tick harvests
 * when, the revert note, the win32 deep-path cases) stays in
 * tests/Dispatcher.test.ts, where the tick that produces it lives.
 */

import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { frictionCountLine, harvestFriction } from "../src/friction.ts";
import type { Chain } from "../src/Phase.ts";
import { makeFixture, silent, type Fixture } from "./helpers/dispatcherFixture.ts";

const exec = promisify(execFile);

describe("friction — harvest and count across the one declared dir", () => {
  let fx: Fixture;

  beforeEach(async () => {
    fx = await makeFixture();
  });

  afterEach(async () => {
    await fx.cleanup();
  });

  it("frictionCountLine is exported from src/friction.ts and counts exactly what the real harvestFriction deposited, the tracked-at-HEAD file excluded", async () => {
    const chain: Chain = { phases: [], humanOnly: [], friction: "friction" };
    const mirrorDir = join(fx.repo, ".flume", "friction");
    await mkdir(mirrorDir, { recursive: true });

    // Delivered content already — committed at the worktree's own HEAD, so
    // the tracked-at-HEAD bound (spec/worktrees.md "Teardown harvest — the
    // delivery guarantee") must leave it where it is.
    await writeFile(join(mirrorDir, "delivered.md"), "already relayed\n");
    await exec("git", ["add", "-A"], { cwd: fx.repo });
    await exec("git", ["commit", "-q", "-m", "relay delivered.md"], {
      cwd: fx.repo,
    });
    // This tick's own note: untracked at HEAD, so this is what harvest owes
    // the operator.
    await writeFile(join(mirrorDir, "note.md"), "the loop wants owner input\n");

    // Vacuity pin (`.claude/rules/engineering.md`, "A green verdict is
    // proven non-vacuous"): harvest is judged on a populated mirror holding
    // one file of each kind, so a count of 1 below is a real exclusion
    // rather than an empty dir agreeing with an empty dir.
    expect((await readdir(mirrorDir)).sort()).toEqual([
      "delivered.md",
      "note.md",
    ]);

    // A primary state root of its own, distinct from the worktree's mirror:
    // the write side resolves chain.friction against this, the read side
    // below against the same value, and nothing else can make them agree.
    const primaryRoot = await mkdtemp(join(tmpdir(), "flume-friction-primary-"));
    try {
      await harvestFriction(chain, fx.repo, "HARVEST-A", {
        flumeDir: primaryRoot,
        stateRootRel: ".flume",
        log: silent,
      });

      expect(await frictionCountLine(primaryRoot, chain)).toBe(
        "friction: 1 note(s) await routing",
      );

      const primaryDir = join(primaryRoot, "friction");
      const landed = await readdir(primaryDir);
      expect(landed).toHaveLength(1);
      expect(landed[0]).toMatch(
        /^HARVEST-A--\d{4}-\d{2}-\d{2}T[\d-]+Z--note\.md$/,
      );
      expect(await readFile(join(primaryDir, landed[0]!), "utf8")).toBe(
        "the loop wants owner input\n",
      );

      // The harvested file left the mirror; the delivered one stayed.
      expect(await readdir(mirrorDir)).toEqual(["delivered.md"]);
    } finally {
      await rm(primaryRoot, { recursive: true, force: true });
    }
  });

  it("harvestFriction is a strict no-op when the chain declares no friction dir, and frictionCountLine stays silent over the same chain", async () => {
    const chain: Chain = { phases: [], humanOnly: [] };
    const mirrorDir = join(fx.repo, ".flume", "friction");
    await mkdir(mirrorDir, { recursive: true });
    await writeFile(join(mirrorDir, "note.md"), "undeclared channel\n");

    const primaryRoot = await mkdtemp(join(tmpdir(), "flume-friction-undecl-"));
    try {
      await harvestFriction(chain, fx.repo, "HARVEST-B", {
        flumeDir: primaryRoot,
        stateRootRel: ".flume",
        log: silent,
      });

      expect(await readdir(primaryRoot)).toEqual([]);
      expect(await readdir(mirrorDir)).toEqual(["note.md"]);
      expect(await frictionCountLine(primaryRoot, chain)).toBeUndefined();
    } finally {
      await rm(primaryRoot, { recursive: true, force: true });
    }
  });
});

describe("frictionCountLine — EACCES/ENOENT split (dispatcher-frictioncountline-loud-or-nothing)", () => {
  it("reads 'friction: unreadable' (not silence) when the declared dir exists but readdir fails for a non-ENOENT reason (dispatcher-frictioncountline-loud-or-nothing)", async () => {
    const stateRoot = await mkdtemp(join(tmpdir(), "flume-fcl-unreadable-"));
    try {
      const frictionDir = join(stateRoot, "friction");
      await mkdir(frictionDir, { recursive: true });
      await writeFile(join(frictionDir, "a.md"), "x\n");
      // Strip traversal permission on the friction dir itself: readdir now
      // fails with EACCES — the dir exists but can't be read — not ENOENT
      // (`.claude/rules/engineering.md`, "Loud or nothing"). Mirrors the
      // EACCES fixture `countFrictionFiles` (`tests/job.test.ts`) uses,
      // now the shared detection this helper reuses.
      await chmod(frictionDir, 0o000);

      const chain: Chain = { phases: [], humanOnly: [], friction: "friction" };
      expect(await frictionCountLine(stateRoot, chain)).toBe(
        "friction: unreadable",
      );
    } finally {
      await chmod(join(stateRoot, "friction"), 0o755).catch(() => {});
      await rm(stateRoot, { recursive: true, force: true });
    }
  });

  it("still reads undefined when the declared dir is absent (ENOENT) — baseline unchanged (dispatcher-frictioncountline-loud-or-nothing)", async () => {
    const stateRoot = await mkdtemp(join(tmpdir(), "flume-fcl-absent-"));
    try {
      const chain: Chain = { phases: [], humanOnly: [], friction: "friction" };
      expect(await frictionCountLine(stateRoot, chain)).toBeUndefined();
    } finally {
      await rm(stateRoot, { recursive: true, force: true });
    }
  });
});
