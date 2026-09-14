/**
 * The worktree module's own surface: the lifecycle `src/worktrees.ts` owns
 * end to end — provision one, tear it down, sweep what a dead run left.
 *
 * The round-trip below is an agreement gate (`.claude/rules/engineering.md`,
 * *A seam gate reads what the real writer wrote*): the real `createWorktree`
 * provisions, and the real `teardownWorktreeInstance` is handed exactly what
 * it returned. The two build the same path and branch from opposite ends —
 * one composes `<base>/<namespace>/<dirName>` and `flume/<namespace>/<slug>`,
 * the other removes whatever it is given — so a one-sided change to the
 * namespacing or the directory bound shows up here as residue left on disk,
 * rather than as a wave that quietly accumulates worktrees and `flume/**`
 * branches until the next startup sweep.
 *
 * The dispatcher's end-to-end worktree behavior — which tick provisions
 * when, the wave-level surviving-path report, the startup sweep driven
 * through `Dispatcher.sweepStaleWorktrees`, the win32 deep-path cases —
 * stays in tests/Dispatcher.test.ts, where the tick that produces it lives.
 */

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { lstat, mkdir, readdir, readFile, symlink, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { Logger } from "../src/Dispatcher.ts";
import { buildFlumeApi } from "../src/flumeApi.ts";
import type { Chain, Phase, WorktreeSetupContext } from "../src/Phase.ts";
import { slugify, worktreesBase } from "../src/paths.ts";
import {
  createWorktree,
  readWorktreeRegistry,
  sweepStaleWorktrees,
  teardownWorktreeInstance,
  worktreeDirName,
  type WorktreeContext,
} from "../src/worktrees.ts";
import { makeFixture, silent, type Fixture } from "./helpers/dispatcherFixture.ts";

const exec = promisify(execFile);

/** A phase carrying nothing but the teardown hook the sequence must fire. */
function phaseWithTeardown(
  onTeardown: (ctx: WorktreeSetupContext) => Promise<void>,
): Phase {
  return {
    name: "build",
    description: "",
    promptPath: "prompt.md",
    concurrency: "fanout",
    writablePaths: ["**"],
    gates: [],
    handoff: () => [],
    teardownWorktree: onTeardown,
  };
}

/** Branches git currently holds under `flume/`, at any depth. */
async function flumeBranches(repo: string): Promise<string[]> {
  const { stdout } = await exec(
    "git",
    ["for-each-ref", "--format=%(refname:short)", "refs/heads/flume/"],
    { cwd: repo },
  );
  return stdout.split("\n").map((l) => l.trim()).filter(Boolean);
}

/** A logger that keeps every warning, for suites judging what the run reported. */
function collectingLogger(): Logger & { warnings: string[] } {
  const warnings: string[] = [];
  return {
    warnings,
    info: () => {},
    warn: (m: string) => warnings.push(m),
    error: () => {},
  };
}

/** Paths git currently considers a worktree of `repo`. */
async function registeredWorktrees(repo: string): Promise<string[]> {
  const { stdout } = await exec("git", ["worktree", "list", "--porcelain"], {
    cwd: repo,
  });
  return stdout
    .split("\n")
    .filter((l) => l.startsWith("worktree "))
    .map((l) => l.slice("worktree ".length).trim());
}

describe("worktrees — one lifecycle over one directory tree", () => {
  let fx: Fixture;

  beforeEach(async () => {
    fx = await makeFixture();
  });

  afterEach(async () => {
    await fx.cleanup();
  });

  it("worktree provisioning and teardown are exported from src/worktrees.ts, and the real teardown removes exactly the path and branch the real provisioning named", async () => {
    // A tag long enough that `worktreeDirName` must truncate-and-hash it:
    // the directory component and the branch component diverge here, which
    // is precisely the disagreement a one-sided change would introduce.
    const tag = `WORKTREES-ROUND-TRIP-${"x".repeat(60)}`;
    const flumeDir = join(fx.repo, ".flume");
    const ctx: WorktreeContext = {
      repoRoot: fx.repo,
      flumeDir,
      stateRootRel: ".flume",
      namespace: "job-a",
      log: silent,
    };
    const chain: Chain = { phases: [], humanOnly: [], friction: "friction" };
    const { stdout: head } = await exec("git", ["rev-parse", "HEAD"], {
      cwd: fx.repo,
    });

    const wt = await createWorktree(tag, head.trim(), ctx);

    // Both components, composed independently of the writer: the branch
    // keeps the untruncated slug, the directory takes the bound.
    expect(wt.branch).toBe(`flume/job-a/${slugify(tag)}`);
    expect(wt.path).toBe(
      join(worktreesBase(flumeDir), "job-a", worktreeDirName(tag)),
    );
    expect(worktreeDirName(tag)).not.toBe(slugify(tag));

    // Vacuity pin (`.claude/rules/engineering.md`, "A green verdict is
    // proven non-vacuous"): teardown below is judged over a worktree and a
    // branch that really exist, so the absences it asserts are removals
    // rather than two things that were never provisioned.
    expect(existsSync(wt.path)).toBe(true);
    expect(await registeredWorktrees(fx.repo)).toContain(wt.path);
    expect(await flumeBranches(fx.repo)).toEqual([wt.branch]);

    // The note this tick's agent would have left behind: untracked at the
    // worktree's own HEAD, so the harvest teardown runs owes it to the
    // primary friction dir.
    const mirrorDir = join(wt.path, ".flume", "friction");
    await mkdir(mirrorDir, { recursive: true });
    await writeFile(join(mirrorDir, "note.md"), "the loop wants input\n");

    const hookSaw: WorktreeSetupContext[] = [];
    const phase = phaseWithTeardown(async (hookCtx) => {
      // Fires while the directory still exists — chain-provisioned ephemera
      // release before removal, not after.
      expect(existsSync(hookCtx.worktreePath)).toBe(true);
      hookSaw.push(hookCtx);
    });

    const removed = await teardownWorktreeInstance(phase, chain, wt, tag, ctx);

    expect(removed).toBe(true);
    expect(hookSaw).toEqual([
      { worktreePath: wt.path, repoRoot: fx.repo, entryTag: tag },
    ]);
    expect(existsSync(wt.path)).toBe(false);
    expect(await registeredWorktrees(fx.repo)).not.toContain(wt.path);
    expect(await flumeBranches(fx.repo)).toEqual([]);
    // The harvest ran between the hook and the removal, so the note
    // survived the directory that held it.
    expect(await readdir(join(flumeDir, "friction"))).toEqual([
      expect.stringContaining(`${tag}--`),
    ]);
  }, 30_000);
});

/**
 * Single-resolution pin (WORKTREE-BASE-RESOLVED-ONCE, per spec/worktrees.md
 * "Placement — the worktree base and the job namespace": *The base is
 * resolved once*). `createWorktree` and `sweepStaleWorktrees` each used to
 * spell `FLUME_WORKTREES_DIR ?? join(flumeDir, "worktrees")` for themselves.
 * They agreed only because the two spellings happened to match: a sweep
 * basing on the default while creation honored the override reads an empty
 * base, removes nothing, and then fails every `git branch -D` against
 * worktrees still standing where creation actually put them (field-traced
 * four times).
 *
 * Agreement between two copies is not checkable by running them — they agree
 * in every tree where the bug has not been introduced yet. What is checkable
 * is that the second copy does not exist, so this reads `src/` and refuses a
 * second reader.
 */
describe("worktrees — the base is resolved in one place", () => {
  const SRC_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..", "src");

  /** A read of the override env var, however it is subscripted. */
  const READS_OVERRIDE =
    /process\.env(?:\.FLUME_WORKTREES_DIR\b|\[\s*["']FLUME_WORKTREES_DIR["']\s*\])/;

  it("src/ resolves the worktree base in exactly one place", async () => {
    const modules = (await readdir(SRC_DIR)).filter((n) => n.endsWith(".ts"));
    // Vacuity (engineering.md, "A green verdict is proven non-vacuous"): a
    // scan that read no modules would report no second reader either.
    expect(modules.length).toBeGreaterThan(0);

    const readers: string[] = [];
    const sources = new Map<string, string>();
    for (const name of modules) {
      const text = await readFile(join(SRC_DIR, name), "utf8");
      sources.set(name, text);
      if (READS_OVERRIDE.test(text)) readers.push(name);
    }

    // The resolver's own module, and nothing else. A second reader is the
    // defect whether or not it currently spells the same fallback.
    expect(readers).toEqual(["paths.ts"]);

    // And the module's two consumers take the base from there rather than
    // rebuilding it: `createWorktree` (whose stale-slug removal runs against
    // the path it computes) and the startup sweep. Keyed on the call, not on
    // how the state root is currently spelled at either site — the claim is
    // that both reach the resolver, not which field holds their root.
    const worktrees = sources.get("worktrees.ts")!;
    expect(worktrees.match(/worktreesBase\(/g) ?? []).toHaveLength(2);
    // No hand-rolled default survives beside them.
    expect(worktrees).not.toMatch(/join\([^)]*[Ff]lumeDir,\s*"worktrees"\)/);
  });
});

/**
 * WORKTREE-STALE-DIR-DISCLAIMED-BY-GIT — what occupies the path a tick is
 * about to provision is git's registry to judge, never the path's mere
 * existence. `createWorktree` and `sweepStaleWorktrees` read one probe
 * (`.claude/rules/engineering.md`, *The fix lands at the mechanism*:
 * detection a sibling surface already performs is shared, never re-derived).
 * The sweep already refused to remove a directory git disclaims — most often
 * a sibling namespaced job's live container directory under a shared
 * `FLUME_WORKTREES_DIR` — while provisioning deleted exactly that directory
 * through its rm fallback and then reported success.
 *
 * Both legs are driven through the real entry points against a real git
 * repo: the claim is that one probe decides for both, which a stubbed
 * registry could not distinguish from two agreeing copies.
 */
describe("worktrees — an occupied path is judged by git's registry", () => {
  let fx: Fixture;

  beforeEach(async () => {
    fx = await makeFixture();
  });

  afterEach(async () => {
    await fx.cleanup();
  });

  /** An unnamespaced context over the fixture repo, and its worktree base. */
  function contextFor(log: Logger): { ctx: WorktreeContext; base: string } {
    const flumeDir = join(fx.repo, ".flume");
    return {
      ctx: {
        repoRoot: fx.repo,
        flumeDir,
        stateRootRel: ".flume",
        namespace: undefined,
        log,
      },
      base: worktreesBase(flumeDir),
    };
  }

  /** The fixture repo's current HEAD, the ref every provisioning branches from. */
  async function head(): Promise<string> {
    const { stdout } = await exec("git", ["rev-parse", "HEAD"], {
      cwd: fx.repo,
    });
    return stdout.trim();
  }

  it("createWorktree leaves a directory git does not know as a worktree of this repo in place", async () => {
    const { ctx, base } = contextFor(silent);
    // Occupying exactly the path provisioning computes — a sibling job's
    // container directory, an operator's own tree, or residue git has
    // already pruned the registration for. Indistinguishable by name.
    const occupied = join(base, worktreeDirName("build"));
    await mkdir(occupied, { recursive: true });
    await writeFile(join(occupied, "keep.txt"), "not flume's to delete\n");

    // Vacuity pin (`.claude/rules/engineering.md`, "A green verdict is
    // proven non-vacuous"): the path really is occupied and git really does
    // disclaim it — the two facts the refusal below is about.
    expect(existsSync(join(occupied, "keep.txt"))).toBe(true);
    expect(await registeredWorktrees(fx.repo)).not.toContain(occupied);

    await expect(createWorktree("build", await head(), ctx)).rejects.toThrow(
      /does not register as a worktree/,
    );

    // Untouched, and provisioning failed rather than succeeding over it.
    expect(await readFile(join(occupied, "keep.txt"), "utf8")).toBe(
      "not flume's to delete\n",
    );
    expect(await registeredWorktrees(fx.repo)).not.toContain(occupied);
    expect(await flumeBranches(fx.repo)).toEqual([]);
  }, 30_000);

  // `existsSync` collapsed every stat failure to `false`, so a path that is
  // on disk but unstattable read as free and provisioning ran straight over
  // it — never reaching the registry judgment above, which is the only thing
  // standing between a sibling job's live container directory and a blind
  // `git worktree add`. The probe now splits ENOENT from the rest
  // (`existsLoud`, src/fsProbe.ts).
  it("createWorktree refuses when the worktree path is present but unstattable", async () => {
    const { ctx, base } = contextFor(silent);
    const occupied = join(base, worktreeDirName("build"));
    await mkdir(dirname(occupied), { recursive: true });
    // ELOOP — present, unstattable. Not a permission bit: a root-run test
    // would bypass that.
    await symlink(worktreeDirName("build"), occupied);

    // Vacuity pins (`.claude/rules/engineering.md`, "A green verdict is
    // proven non-vacuous"): something really is at the path, and the stat
    // that decides really does fail on it.
    expect((await lstat(occupied)).isSymbolicLink()).toBe(true);
    expect(existsSync(occupied)).toBe(false);

    await expect(createWorktree("build", await head(), ctx)).rejects.toThrow(
      /ELOOP/,
    );

    // The refusal landed at the probe: nothing was provisioned over the
    // occupant, and the symlink is still standing for an operator to judge.
    expect((await lstat(occupied)).isSymbolicLink()).toBe(true);
    expect(await registeredWorktrees(fx.repo)).not.toContain(occupied);
    expect(await flumeBranches(fx.repo)).toEqual([]);
  }, 30_000);

  it("createWorktree removes a stale worktree directory git still has registered", async () => {
    const { ctx, base } = contextFor(silent);
    // What a crashed run actually leaves: a registered worktree at the path
    // this entry is about to be provisioned into, plus its untracked residue.
    const stale = join(base, worktreeDirName("build"));
    await mkdir(dirname(stale), { recursive: true });
    await exec(
      "git",
      ["worktree", "add", "-B", "stale/build", stale, "HEAD"],
      { cwd: fx.repo },
    );
    await writeFile(join(stale, "crashed.txt"), "residue\n");
    expect(await registeredWorktrees(fx.repo)).toContain(stale);

    const wt = await createWorktree("build", await head(), ctx);

    expect(wt.path).toBe(stale);
    // Removed and re-provisioned rather than reused: the crashed run's
    // residue is gone and the path is registered on the branch this call
    // named, not on the one it displaced.
    expect(existsSync(join(stale, "crashed.txt"))).toBe(false);
    expect(await registeredWorktrees(fx.repo)).toContain(stale);
    expect(await flumeBranches(fx.repo)).toEqual([wt.branch]);
  }, 30_000);

  it("the startup sweep warns that it removed nothing when the worktree registry cannot be read", async () => {
    const log = collectingLogger();
    const { ctx, base } = contextFor(log);
    const residue = join(base, "orphan");
    await mkdir(dirname(residue), { recursive: true });
    await exec(
      "git",
      ["worktree", "add", "-B", "flume/orphan", residue, "HEAD"],
      { cwd: fx.repo },
    );

    // Vacuity pin: the base holds a real registered worktree, so a readable
    // registry would have removed exactly this one. "Removed nothing" below
    // is therefore a refusal, not an empty base reporting itself.
    expect(await readdir(base)).toContain("orphan");
    expect(await registeredWorktrees(fx.repo)).toContain(residue);

    // A repo root git cannot run in: the probe fails rather than returning
    // an empty registry, and the failure must not read as "git registers
    // nothing under this base".
    const blindCtx: WorktreeContext = {
      ...ctx,
      repoRoot: join(fx.repo, "no-such-dir"),
    };

    await sweepStaleWorktrees(blindCtx);

    expect(log.warnings).toContainEqual(
      expect.stringContaining("removed no worktree directories"),
    );
    expect(existsSync(residue)).toBe(true);
    expect(await registeredWorktrees(fx.repo)).toContain(residue);
  }, 30_000);
});

/**
 * FLUMEAPI-REPORTS-THE-WORKTREE-REGISTRY — the registry is a fact the engine
 * already decodes for its own provisioning and sweep judgments
 * (`.claude/rules/engineering.md`, *A fact the engine holds is reported,
 * never rediscovered*), so a chain reclaiming what it allocated per worktree
 * asks the API rather than listing the worktree base
 * (`.claude/rules/engine-boundary.md`, *Surface, not prescription*: a hook
 * receives facts, never re-derives them).
 *
 * Driven off the real `buildFlumeApi()` against a real repo, with the real
 * `createWorktree` as the writer whose output the read has to name: a stubbed
 * registry would agree with a hand-authored path set and prove nothing about
 * what git actually registers (`engineering.md`, *A seam gate reads what the
 * real writer wrote*).
 */
describe("worktrees — git's registry on the API a chain factory receives", () => {
  let fx: Fixture;

  beforeEach(async () => {
    fx = await makeFixture();
  });

  afterEach(async () => {
    await fx.cleanup();
  });

  /** The API a chain factory would receive for the fixture repo. */
  function apiFor(): ReturnType<typeof buildFlumeApi> {
    const flumeDir = join(fx.repo, ".flume");
    return buildFlumeApi({
      repoRoot: fx.repo,
      configDir: flumeDir,
      flumeDir,
    });
  }

  /** An unnamespaced worktree context over the fixture repo. */
  function contextFor(): WorktreeContext {
    return {
      repoRoot: fx.repo,
      flumeDir: join(fx.repo, ".flume"),
      stateRootRel: ".flume",
      namespace: undefined,
      log: silent,
    };
  }

  /** The fixture repo's current HEAD, the ref every provisioning branches from. */
  async function head(): Promise<string> {
    const { stdout } = await exec("git", ["rev-parse", "HEAD"], {
      cwd: fx.repo,
    });
    return stdout.trim();
  }

  it("FlumeApi reports the worktrees git registers for the repo", async () => {
    const api = apiFor();
    // The same probe the harness judges an occupied path on, not a second
    // spelling handed out beside it.
    expect(api.git.readWorktreeRegistry).toBe(readWorktreeRegistry);

    const ctx = contextFor();
    const one = await createWorktree("REAP-ONE", await head(), ctx);
    const two = await createWorktree("REAP-TWO", await head(), ctx);

    const registry = await api.git.readWorktreeRegistry(fx.repo);

    expect(registry.read).toBe(true);
    if (!registry.read) throw new Error("unreachable: asserted above");
    // Vacuity pin (`.claude/rules/engineering.md`, "A green verdict is proven
    // non-vacuous"): the set below is judged against every path git names,
    // read independently of the API, so a registry that collapsed to one
    // entry — or to none — could not report green here.
    const registered = await registeredWorktrees(fx.repo);
    expect(registered.length).toBe(3);
    expect(registry.paths.size).toBe(registered.length);

    // Both provisioned arms, by the paths the real writer returned — and the
    // primary checkout, which git names and the engine does not filter out.
    expect(registry.paths.has(resolve(one.path))).toBe(true);
    expect(registry.paths.has(resolve(two.path))).toBe(true);
    expect(registry.paths.has(resolve(fx.repo))).toBe(true);

    // A torn-down arm leaves the list, so a reaper that deletes what the
    // registry no longer names frees exactly the dead one's handle.
    const chain: Chain = { phases: [], humanOnly: [], friction: "friction" };
    const phase: Phase = phaseWithTeardown(async () => {});
    expect(
      await teardownWorktreeInstance(phase, chain, one, "REAP-ONE", ctx),
    ).toBe(true);

    const after = await api.git.readWorktreeRegistry(fx.repo);
    expect(after.read).toBe(true);
    if (!after.read) throw new Error("unreachable: asserted above");
    expect(after.paths.has(resolve(one.path))).toBe(false);
    expect(after.paths.has(resolve(two.path))).toBe(true);
  }, 30_000);

  it("an unreadable worktree registry reports the failure rather than an empty set", async () => {
    const api = apiFor();
    const wt = await createWorktree("REAP-LIVE", await head(), contextFor());

    // Vacuity pin: over the real repo the same call reads a populated
    // registry, so the failure below is this probe refusing — not a read that
    // never works.
    const readable = await api.git.readWorktreeRegistry(fx.repo);
    expect(readable.read).toBe(true);
    if (!readable.read) throw new Error("unreachable: asserted above");
    expect(readable.paths.has(resolve(wt.path))).toBe(true);

    // A repo root git cannot run in. An absent worktree is the claim a reaper
    // frees a handle on, so "could not ask" must not wear that claim's shape.
    const blind = await api.git.readWorktreeRegistry(
      join(fx.repo, "no-such-dir"),
    );

    expect(blind.read).toBe(false);
    if (blind.read) throw new Error("unreachable: asserted above");
    expect(blind.reason.length).toBeGreaterThan(0);
    // The failing branch carries no path set at all, so a consumer cannot
    // reach for one and read absence out of a failure.
    expect(blind).not.toHaveProperty("paths");
  }, 30_000);
});
