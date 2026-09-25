/**
 * The worktree module's own surface: the lifecycle `src/worktrees.ts` owns
 * end to end — provision one, tear it down, sweep what a dead run left.
 *
 * The round-trip below is an agreement gate (`.claude/rules/engineering.md`,
 * *A seam gate reads what the real writer wrote*): the real `createWorktree`
 * provisions, and the real `teardownWorktreeInstance` is handed exactly what
 * it returned. The two build the same path and branch from opposite ends —
 * one composes `<base>/<dirName>` and `flume/<checkout>/<slug>`, the other removes
 * whatever it is given — so a one-sided change to the naming or the
 * directory bound shows up here as residue left on disk,
 * rather than as a wave that quietly accumulates worktrees and `flume/**`
 * branches until the next startup sweep.
 *
 * The dispatcher's end-to-end worktree behavior — which tick provisions
 * when, the wave-level surviving-path report, the startup sweep driven
 * through `Dispatcher.sweepStaleWorktrees`, the win32 deep-path cases —
 * stays in tests/Dispatcher.test.ts, where the tick that produces it lives.
 */

import { existsSync } from "node:fs";
import { lstat, mkdir, readdir, readFile, symlink, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Logger } from "../src/log.ts";
import { buildFlumeApi } from "../src/flumeApi.ts";
import type { Chain, Phase, WorktreeSetupContext } from "../src/Phase.ts";
import { slugify, worktreesBase } from "../src/paths.ts";
import {
  checkoutAt,
  createWorktree,
  readWorktreeRegistry,
  stampWorktree,
  sweepStaleWorktrees,
  teardownWorktreeInstance,
  withGateCheckouts,
  worktreeDirName,
  type WorktreeContext,
} from "../src/worktrees.ts";
import { makeFixture, silent, type Fixture } from "./helpers/dispatcherFixture.ts";
import { SPAWN_BUDGET_MS, exec } from "./helpers/subprocess.ts";

/**
 * The names of the git calls whose *order* the provisioning suite below
 * judges, in the order `src/worktrees.ts` actually made them. Hoisted, so the
 * factory's wrappers close over an array that already exists when the mocked
 * module is first pulled in.
 */
const gitCalls = vi.hoisted(() => [] as string[]);

/**
 * Partial mock over the git module both provisioning sites call: every export
 * is the real one, and the two whose sequence is the property record their
 * name on the way through — so the suites that do not care about the order
 * run against unchanged behaviour.
 *
 * A call-sequence spy rather than a config read, because the pin's *effect*
 * is win32-only: `pinLongPaths` (`src/git.ts`) returns immediately off win32,
 * so asserting `core.longpaths` is set can only be done on one host
 * (`tests/helpers/host-declarations.json`) and says nothing about when the
 * call happened even there. The call itself is made on every platform, which
 * is what makes the ordering decidable in the default lane.
 */
vi.mock("../src/git.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/git.ts")>();
  return {
    ...actual,
    pinLongPaths: async (...args: Parameters<typeof actual.pinLongPaths>) => {
      gitCalls.push("pinLongPaths");
      return actual.pinLongPaths(...args);
    },
    addWorktree: async (...args: Parameters<typeof actual.addWorktree>) => {
      gitCalls.push("addWorktree");
      return actual.addWorktree(...args);
    },
  };
});

// This file starts processes, so it declares the lane's one budget — cases
// and hooks alike — once here rather than inheriting the runner's default
// (`SPAWN_BUDGET_MS`, `tests/helpers/subprocess.ts`).
vi.setConfig({ testTimeout: SPAWN_BUDGET_MS, hookTimeout: SPAWN_BUDGET_MS });

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

/**
 * Paths git currently considers a worktree of `repo` — the independent read
 * the probe's own result is judged against. NUL-separated, because
 * `--porcelain` alone neither escapes nor quotes a path: a newline-bearing
 * one arrives split across records there, so the reader a vacuity pin leans
 * on would mangle exactly the paths these suites exist to carry.
 *
 * Resolved absolute as it leaves, the same fold the probe under test applies
 * (`src/worktrees.ts`, `readWorktreeRegistry`) and the same one the sibling
 * reader in `tests/Dispatcher.test.ts` gets from it. Git prints its own
 * absolute spelling — forward-slashed on win32 too — and every caller below
 * judges membership against a path `join`-composed on the host, so an
 * unfolded read compares two spellings of one directory and reds on the
 * comparison rather than on the behaviour.
 */
async function registeredWorktrees(repo: string): Promise<string[]> {
  const { stdout } = await exec(
    "git",
    ["worktree", "list", "--porcelain", "-z"],
    { cwd: repo },
  );
  return stdout
    .split("\0")
    .filter((f) => f.startsWith("worktree "))
    .map((f) => resolve(f.slice("worktree ".length)));
}

/**
 * The state root named by the stamp on the worktree at `path`, read
 * independently of the module under test: git is asked where it keeps the
 * worktree's admin directory, and the filename is spelled here rather than
 * imported. Importing the writer's constant would make the name agree with
 * itself, which is the one thing this seam cannot afford.
 *
 * One home for both suites that read a stamp — the sweep's evidence and
 * provisioning's occupied-path judgment read the same file, and a second
 * spelling is how one of them comes to read a name the writer never wrote
 * (`.claude/rules/engineering.md`, *A module is one job*).
 */
async function stampAt(path: string): Promise<string | undefined> {
  const { stdout } = await exec("git", ["rev-parse", "--absolute-git-dir"], {
    cwd: path,
  });
  try {
    return (
      await readFile(join(stdout.trim(), "flume-state-root"), "utf8")
    ).trim();
  } catch {
    return undefined;
  }
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
      log: silent,
    };
    const chain: Chain = { phases: [], humanOnly: [], friction: "friction" };
    const { stdout: head } = await exec("git", ["rev-parse", "HEAD"], {
      cwd: fx.repo,
    });

    const wt = await createWorktree(tag, head.trim(), ctx);

    // Both components, composed independently of the writer: the branch
    // carries this checkout's segment — `primary`, since the fixture repo is
    // a repository's own checkout and not a linked one — then the untruncated
    // slug, while the directory takes the bound.
    expect(wt.branch).toBe(`flume/primary/${slugify(tag)}`);
    expect(wt.path).toBe(join(worktreesBase(flumeDir), worktreeDirName(tag)));
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
      { worktreePath: wt.path, repoRoot: fx.repo, worktreeKey: tag },
    ]);
    expect(existsSync(wt.path)).toBe(false);
    expect(await registeredWorktrees(fx.repo)).not.toContain(wt.path);
    expect(await flumeBranches(fx.repo)).toEqual([]);
    // The harvest ran between the hook and the removal, so the note
    // survived the directory that held it.
    expect(await readdir(join(flumeDir, "friction"))).toEqual([
      expect.stringContaining(`${tag}--`),
    ]);
  });

  /**
   * Two checkouts of one repository, both running the same singleton phase.
   * They have two state roots and two worktree bases, so nothing about the
   * directories collides — but they share one ref namespace, and a branch
   * checked out in one is a branch `git worktree add -B` refuses to reset in
   * the other. That refusal is what the checkout segment in the branch name
   * removes (`spec/worktrees.md`, *Fanout is the engine's declared navigation
   * carve-out*).
   *
   * Both checkouts are real, and both branches come back from the real
   * `createWorktree` (`.claude/rules/engineering.md`, *A seam gate reads what
   * the real writer wrote*).
   */
  it("two linked checkouts of one repository each provision the same singleton phase at once and both succeed", async () => {
    const { stdout: head } = await exec("git", ["rev-parse", "HEAD"], {
      cwd: fx.repo,
    });
    const at = (root: string): WorktreeContext => ({
      repoRoot: root,
      flumeDir: join(root, ".flume"),
      stateRootRel: ".flume",
      log: silent,
    });

    // Two linked checkouts, so neither is the primary one the round-trip
    // above provisions from: the segment has to separate two *linked* trees,
    // which is the case a primary-versus-linked fold alone would miss.
    const roots: string[] = [];
    for (const name of ["effort-a", "effort-b"]) {
      const root = join(fx.repo, name);
      await exec(
        "git",
        ["worktree", "add", "-q", "-b", name, root, head.trim()],
        { cwd: fx.repo },
      );
      roots.push(root);
    }
    const [a = "", b = ""] = roots;

    // One phase name, two checkouts. The second call is the one that used to
    // fail: `flume/plan` was already checked out in the first's worktree.
    const first = await createWorktree("plan", head.trim(), at(a));
    const second = await createWorktree("plan", head.trim(), at(b));

    // Both provisioned, both alive at the same moment.
    expect(existsSync(first.path)).toBe(true);
    expect(existsSync(second.path)).toBe(true);
    const registered = await registeredWorktrees(fx.repo);
    expect(registered).toContain(resolve(first.path));
    expect(registered).toContain(resolve(second.path));

    // Two branches, differing in the checkout segment alone — and the shared
    // namespace really is one namespace, since git names both from either
    // checkout.
    expect(first.branch).not.toBe(second.branch);
    expect(first.branch.endsWith(`/${slugify("plan")}`)).toBe(true);
    expect(second.branch.endsWith(`/${slugify("plan")}`)).toBe(true);
    expect(await flumeBranches(a)).toEqual(
      [first.branch, second.branch].sort(),
    );
    expect(await flumeBranches(b)).toEqual(await flumeBranches(a));
  });
});

/**
 * Single-resolution pin (WORKTREE-BASE-RESOLVED-ONCE, per spec/worktrees.md
 * "Placement — the worktree base": *The base is
 * resolved once*). `createWorktree` and `sweepStaleWorktrees` each used to
 * spell `FLUME_WORKTREES_DIR ?? join(flumeDir, "worktrees")` for themselves.
 * They agreed only because the two spellings happened to match: a sweep
 * basing on the default while creation honored the override reads an empty
 * base and removes nothing, leaving every abandoned worktree — and the
 * branch each was checked out on, which is the only key the branch leg has —
 * standing where creation actually put them (field-traced four times).
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
    // Vacuity (.claude/rules/engineering.md, "A green verdict is proven
    // non-vacuous"): a scan that read no modules would report no second reader
    // either.
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

    // And the module's three consumers take the base from there rather than
    // rebuilding it: `createWorktree` (whose stale-slug removal runs against
    // the path it computes), the startup sweep, and `checkoutAt` (which
    // plants a differential gate's detached tree at the level the sweep
    // reads). Keyed on the call, not on how the state root is currently
    // spelled at any of the sites — the claim is that all three reach the
    // resolver, not which field holds their root.
    const worktrees = sources.get("worktrees.ts")!;
    expect(worktrees.match(/worktreesBase\(/g) ?? []).toHaveLength(3);
    // No hand-rolled default survives beside them.
    expect(worktrees).not.toMatch(/join\([^)]*[Ff]lumeDir,\s*"worktrees"\)/);
  });
});

/**
 * WORKTREE-STALE-DIR-DISCLAIMED-BY-GIT — what occupies the path a tick is
 * about to provision is judged on the two pieces of evidence
 * `sweepStaleWorktrees` judges a dead run's residue on, never the path's
 * mere existence: git's registry, then this state root's own stamp
 * (`.claude/rules/engineering.md`, *The fix lands at the mechanism*:
 * detection a sibling surface already performs is shared, never re-derived).
 *
 * The sweep already refused on both — a directory git disclaims is an
 * operator's own tree or residue whose registration git had already pruned;
 * a registered directory this root never stamped is a second checkout's live
 * tree under a base the operator deliberately shares (`spec/worktrees.md`,
 * *Placement — the worktree base*). Provisioning deleted each of them
 * through its rm fallback and then reported success, so a colliding
 * `dirName` took a running sibling's worktree out from under it.
 *
 * Every leg is driven through the real entry points against a real git repo:
 * the claim is that one probe and one stamp read decide for both sites,
 * which a stubbed registry could not distinguish from two agreeing copies.
 */
describe("worktrees — an occupied path is judged by git's registry", () => {
  let fx: Fixture;

  beforeEach(async () => {
    fx = await makeFixture();
  });

  afterEach(async () => {
    await fx.cleanup();
  });

  /** A context over the fixture repo, and its worktree base. */
  function contextFor(log: Logger): { ctx: WorktreeContext; base: string } {
    const flumeDir = join(fx.repo, ".flume");
    return {
      ctx: {
        repoRoot: fx.repo,
        flumeDir,
        stateRootRel: ".flume",
        log,
      },
      base: worktreesBase(flumeDir),
    };
  }

  /**
   * A second state root over the same repository, provisioning into the
   * first's base — the placement a sibling checkout sharing
   * `FLUME_WORKTREES_DIR` produces, where both roots' trees land in the one
   * registry each of them reads and a shared tag collides on one directory
   * name.
   */
  function siblingRootAt(base: string, log: Logger): WorktreeContext {
    return {
      repoRoot: fx.repo,
      flumeDir: join(fx.repo, ".flume-sibling"),
      stateRootRel: ".flume-sibling",
      log,
      declaredWorktreesBase: base,
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
    // Occupying exactly the path provisioning computes — an operator's own
    // tree, or residue git has already pruned the registration for.
    // Indistinguishable by name.
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
  });

  // `existsSync` collapsed every stat failure to `false`, so a path that is
  // on disk but unstattable read as free and provisioning ran straight over
  // it — never reaching the registry judgment above, which is the only thing
  // standing between a directory git disclaims and a blind
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
  });

  it("createWorktree clears an occupied worktree path this state root stamped", async () => {
    const { ctx } = contextFor(silent);
    // What a crashed run actually leaves: a registered worktree at the path
    // this entry is about to be provisioned into, plus its untracked
    // residue. Planted through the real writer, so the stamp the judgment
    // below reads is the one provisioning actually mints — a hand-run
    // `worktree add` would agree with whatever this test believed, including
    // that there is no stamp at all (`.claude/rules/engineering.md`, *A seam
    // gate reads what the real writer wrote*).
    const stale = await createWorktree("build", await head(), ctx);
    await writeFile(join(stale.path, "crashed.txt"), "residue\n");

    // Vacuity pin (`.claude/rules/engineering.md`, "A green verdict is
    // proven non-vacuous"): the path really is occupied, really is
    // registered, and really carries this root's stamp — the three facts the
    // clearance below turns on.
    expect(existsSync(join(stale.path, "crashed.txt"))).toBe(true);
    expect(await registeredWorktrees(fx.repo)).toContain(stale.path);
    expect(await stampAt(stale.path)).toBe(resolve(ctx.flumeDir));

    const wt = await createWorktree("build", await head(), ctx);

    expect(wt.path).toBe(stale.path);
    // Removed and re-provisioned rather than reused: the crashed run's
    // residue is gone and the path is registered on the branch this call
    // named.
    expect(existsSync(join(stale.path, "crashed.txt"))).toBe(false);
    expect(await registeredWorktrees(fx.repo)).toContain(wt.path);
    expect(await flumeBranches(fx.repo)).toEqual([wt.branch]);
    expect(await stampAt(wt.path)).toBe(resolve(ctx.flumeDir));
  });

  it("createWorktree refuses an occupied worktree path git registers but this state root did not stamp", async () => {
    const { ctx, base } = contextFor(silent);
    // The collision *Placement* names: a second checkout's live worktree,
    // provisioned by the same writer into a base the operator shares, on a
    // tag whose bounded directory name matches this tick's. git registers it
    // as a worktree of this repository exactly as it registers this root's
    // own trees, so the registry alone cannot tell them apart.
    const sibling = siblingRootAt(base, silent);
    const theirs = await createWorktree("build", await head(), sibling);
    await writeFile(join(theirs.path, "live.txt"), "a running tick's tree\n");

    // Vacuity pin: the path this tick would provision into is exactly the
    // sibling's, git names it, and the stamp on it is the sibling's rather
    // than this root's — so the refusal below is the stamp's verdict, not a
    // path provisioning never reached.
    expect(theirs.path).toBe(join(base, worktreeDirName("build")));
    expect(await registeredWorktrees(fx.repo)).toContain(theirs.path);
    expect(await stampAt(theirs.path)).toBe(resolve(sibling.flumeDir));
    expect(await stampAt(theirs.path)).not.toBe(resolve(ctx.flumeDir));

    await expect(createWorktree("build", await head(), ctx)).rejects.toThrow(
      /did not provision/,
    );

    // The sibling's tick still has its tree, its residue and its branch, and
    // this tick failed rather than succeeding over it.
    expect(await readFile(join(theirs.path, "live.txt"), "utf8")).toBe(
      "a running tick's tree\n",
    );
    expect(await registeredWorktrees(fx.repo)).toContain(theirs.path);
    expect(await flumeBranches(fx.repo)).toEqual([theirs.branch]);
  });

  it("createWorktree refuses an occupied registered worktree carrying no stamp at all", async () => {
    const { ctx, base } = contextFor(silent);
    // Residue from a run that predates the stamp, or a provisioning that
    // died between the add and the stamp: registered, unstamped, and the
    // same refusal the sweep takes on it (`spec/worktrees.md`, *Startup
    // sweep — a dead wave's residue is removed at the next start*) — the
    // pre-stamp tree now needs a hand rather than being cleared on the
    // registry's word.
    const unstamped = join(base, worktreeDirName("build"));
    await mkdir(dirname(unstamped), { recursive: true });
    await exec(
      "git",
      ["worktree", "add", "-B", "flume/build", unstamped, "HEAD"],
      { cwd: fx.repo },
    );

    // Vacuity pin: git registers the path, and nothing stamped it.
    expect(await registeredWorktrees(fx.repo)).toContain(unstamped);
    expect(await stampAt(unstamped)).toBeUndefined();

    await expect(createWorktree("build", await head(), ctx)).rejects.toThrow(
      /no stamp/,
    );

    expect(existsSync(unstamped)).toBe(true);
    expect(await registeredWorktrees(fx.repo)).toContain(unstamped);
  });

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
  });
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
 * registry would agree with a hand-authored path map and prove nothing about
 * what git actually registers (`.claude/rules/engineering.md`, *A seam gate
 * reads what the real writer wrote*).
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

  /** A worktree context over the fixture repo. */
  function contextFor(): WorktreeContext {
    return {
      repoRoot: fx.repo,
      flumeDir: join(fx.repo, ".flume"),
      stateRootRel: ".flume",
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

  /**
   * The branch half of the same report. The startup sweep's branch leg reaps
   * what its directory leg removed, so the pairing git already printed beside
   * each path is a fact the engine decodes once and hands out, rather than one
   * a caller rebuilds from a ref glob over a namespace two checkouts share
   * (`.claude/rules/engineering.md`, *A fact the engine holds is reported,
   * never rediscovered*).
   */
  it("the worktree registry reports the branch each worktree is checked out on", async () => {
    const api = apiFor();
    const ctx = contextFor();
    // The real writer for the attached arm: whatever branch spelling
    // `createWorktree` composes is the one the read has to name back.
    const wt = await createWorktree("BRANCH-REPORTED", await head(), ctx);
    // And the detached arm, the shape a gate's `checkoutAt` plants: git names
    // no branch for it, so neither may the registry.
    const detached = join(worktreesBase(join(fx.repo, ".flume")), "detached");
    await mkdir(dirname(detached), { recursive: true });
    await exec("git", ["worktree", "add", "--detach", detached, "HEAD"], {
      cwd: fx.repo,
    });

    const registry = await api.git.readWorktreeRegistry(fx.repo);
    expect(registry.read).toBe(true);
    if (!registry.read) throw new Error("unreachable: asserted above");

    // Vacuity pin (`.claude/rules/engineering.md`, "A green verdict is proven
    // non-vacuous"): every path git names arrived, read off git's own list —
    // so the branch verdicts below are judged over a populated report rather
    // than over a record the decode dropped.
    const registered = await registeredWorktrees(fx.repo);
    expect(registered.length).toBe(3);
    expect(registry.worktrees.size).toBe(registered.length);

    // The branch the real writer named, in the short spelling
    // `git.deleteBranch` takes — not the `refs/heads/…` ref git prints.
    expect(registry.worktrees.get(resolve(wt.path))).toBe(wt.branch);
    expect(wt.branch).toBe(`flume/primary/${slugify("BRANCH-REPORTED")}`);

    // Detached: registered, and carrying no branch. The two facts are
    // separate — "git names no branch here" must not read as "git does not
    // name this path".
    expect(registry.worktrees.has(resolve(detached))).toBe(true);
    expect(registry.worktrees.get(resolve(detached))).toBeUndefined();

    // The primary checkout's own branch is reported too: this is git's list,
    // and which of its rows a caller owns is the caller's to decide.
    const { stdout: onBranch } = await exec(
      "git",
      ["rev-parse", "--abbrev-ref", "HEAD"],
      { cwd: fx.repo },
    );
    expect(registry.worktrees.get(resolve(fx.repo))).toBe(onBranch.trim());
  });

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
    expect(registry.worktrees.size).toBe(registered.length);

    // Both provisioned arms, by the paths the real writer returned — and the
    // primary checkout, which git names and the engine does not filter out.
    expect(registry.worktrees.has(resolve(one.path))).toBe(true);
    expect(registry.worktrees.has(resolve(two.path))).toBe(true);
    expect(registry.worktrees.has(resolve(fx.repo))).toBe(true);

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
    expect(after.worktrees.has(resolve(one.path))).toBe(false);
    expect(after.worktrees.has(resolve(two.path))).toBe(true);
  });

  it("an unreadable worktree registry reports the failure rather than an empty set", async () => {
    const api = apiFor();
    const wt = await createWorktree("REAP-LIVE", await head(), contextFor());

    // Vacuity pin: over the real repo the same call reads a populated
    // registry, so the failure below is this probe refusing — not a read that
    // never works.
    const readable = await api.git.readWorktreeRegistry(fx.repo);
    expect(readable.read).toBe(true);
    if (!readable.read) throw new Error("unreachable: asserted above");
    expect(readable.worktrees.has(resolve(wt.path))).toBe(true);

    // A repo root git cannot run in. An absent worktree is the claim a reaper
    // frees a handle on, so "could not ask" must not wear that claim's shape.
    const blind = await api.git.readWorktreeRegistry(
      join(fx.repo, "no-such-dir"),
    );

    expect(blind.read).toBe(false);
    if (blind.read) throw new Error("unreachable: asserted above");
    expect(blind.reason.length).toBeGreaterThan(0);
    // The failing branch carries no worktree map at all, so a consumer cannot
    // reach for one and read absence out of a failure.
    expect(blind).not.toHaveProperty("worktrees");
  });

  /**
   * Register a worktree of the fixture repo at a path git spells verbatim,
   * under the same base `createWorktree` provisions into — `git worktree
   * add` is the real writer whose output the probe has to name back, and a
   * path this odd is one `createWorktree`'s own slugified tag can never
   * produce.
   */
  async function addWorktreeAt(name: string, branch: string): Promise<string> {
    const path = join(worktreesBase(join(fx.repo, ".flume")), name);
    await mkdir(dirname(path), { recursive: true });
    await exec("git", ["worktree", "add", "-q", path, "-b", branch], {
      cwd: fx.repo,
    });
    return path;
  }

  // Not win32: a control character is illegal in a path there, and trailing
  // whitespace is stripped by path normalization before any file is created,
  // so neither case can be built on that host.
  const onPosix = process.platform !== "win32";

  it.runIf(onPosix)(
    "the worktree registry carries a newline-bearing path as the one path git named",
    async () => {
      const api = apiFor();
      const odd = await addWorktreeAt("we ird\nnl", "flume/odd-newline");

      // Vacuity pin, read off git's own list rather than the probe under
      // test: git names the primary checkout and this worktree, and it names
      // the odd one by its whole path.
      const registered = await registeredWorktrees(fx.repo);
      expect(registered.length).toBe(2);
      expect(registered).toContain(odd);

      const registry = await api.git.readWorktreeRegistry(fx.repo);
      expect(registry.read).toBe(true);
      if (!registry.read) throw new Error("unreachable: asserted above");

      // Exactly what git named, path for path: nothing dropped, nothing
      // invented.
      expect([...registry.worktrees.keys()].sort()).toEqual([...registered].sort());
      expect(registry.worktrees.has(resolve(odd))).toBe(true);
      // The spelling a newline-separated read leaves behind. Every caller
      // judges membership by exact match, so this prefix standing in for the
      // real path is an occupied path refused as git-unowned and residue the
      // sweep declines to remove.
      expect(registry.worktrees.has(resolve(odd.split("\n")[0]!))).toBe(false);
    },
  );

  it.runIf(onPosix)(
    "the worktree registry keeps a worktree path's trailing whitespace",
    async () => {
      const api = apiFor();
      const odd = await addWorktreeAt("trailing ", "flume/odd-trailing");

      // Vacuity pin: git prints the trailing space, so the probe has
      // something to lose.
      const registered = await registeredWorktrees(fx.repo);
      expect(registered.length).toBe(2);
      expect(registered).toContain(odd);

      const registry = await api.git.readWorktreeRegistry(fx.repo);
      expect(registry.read).toBe(true);
      if (!registry.read) throw new Error("unreachable: asserted above");

      expect([...registry.worktrees.keys()].sort()).toEqual([...registered].sort());
      expect(registry.worktrees.has(resolve(odd))).toBe(true);
      // The trimmed spelling names a directory that does not exist, and no
      // caller's path ever matches it.
      expect(registry.worktrees.has(resolve(odd.trimEnd()))).toBe(false);
    },
  );
});

/**
 * The startup sweep's branch leg, bound by the registry the directory leg
 * reads (`spec/worktrees.md`, "Startup sweep — a dead wave's residue is
 * removed at the next start"). The leg used to reap by name — every
 * `flume/…` ref the instance's own glob matched — which is neither half of
 * what the sweep owns: two checkouts of one repository are both grantable a
 * tip claim and sweep against one shared ref namespace, so a name match
 * reaches a live branch this base never held, while residue whose branch is
 * spelled outside the glob is left standing.
 *
 * Both legs run against a real repo through the real `sweepStaleWorktrees`,
 * with `git worktree add` as the writer whose pairing the sweep has to read
 * back (`.claude/rules/engineering.md`, *A seam gate reads what the real
 * writer wrote*): a hand-authored registry would agree with whatever the
 * sweep believed.
 */
describe("worktrees — the startup sweep reaps the branches its own directories held", () => {
  let fx: Fixture;

  beforeEach(async () => {
    fx = await makeFixture();
  });

  afterEach(async () => {
    await fx.cleanup();
  });

  /** A context over the fixture repo, and its sweep base. */
  function contextFor(): { ctx: WorktreeContext; base: string } {
    const flumeDir = join(fx.repo, ".flume");
    return {
      ctx: {
        repoRoot: fx.repo,
        flumeDir,
        stateRootRel: ".flume",
        log: silent,
      },
      base: worktreesBase(flumeDir),
    };
  }

  /**
   * Residue a killed tick left: a registered worktree at `path`, on `branch`,
   * stamped with the state root that would have provisioned it. The stamp is
   * written by the real `stampWorktree` rather than by hand — it is the
   * evidence the sweep removes on (`spec/worktrees.md`, *Startup sweep — a
   * dead wave's residue is removed at the next start*), and a fixture
   * spelling it itself would agree with whatever the reader believed
   * (`.claude/rules/engineering.md`, *A seam gate reads what the real writer
   * wrote*).
   */
  async function plantResidue(path: string, branch: string): Promise<void> {
    await mkdir(dirname(path), { recursive: true });
    await exec("git", ["worktree", "add", "-B", branch, path, "HEAD"], {
      cwd: fx.repo,
    });
    await stampWorktree(path, contextFor().ctx.flumeDir);
  }

  it("the startup sweep deletes the branch a worktree it removed was checked out on", async () => {
    // Residue whose branch is spelled outside whatever glob the instance
    // would have reached for — what a tick that died under an older branch
    // grammar leaves behind. The directory is squarely this run's: it sits
    // under its own sweep base, and git registers it.
    const { ctx, base } = contextFor();
    const residue = join(base, "left-behind");
    await plantResidue(residue, "flume/orphan");

    // Vacuity pin (`.claude/rules/engineering.md`, "A green verdict is proven
    // non-vacuous"): the directory is really registered and the branch really
    // stands going in, so both absences below are removals.
    expect(await registeredWorktrees(fx.repo)).toContain(residue);
    expect(await flumeBranches(fx.repo)).toEqual(["flume/orphan"]);

    await sweepStaleWorktrees(ctx);

    expect(existsSync(residue)).toBe(false);
    expect(await registeredWorktrees(fx.repo)).not.toContain(residue);
    // Reaped by the pairing git reported, not by a glob the branch's spelling
    // happens to satisfy.
    expect(await flumeBranches(fx.repo)).toEqual([]);
  });

  it("the startup sweep leaves a flume branch no worktree under its base was checked out on standing", async () => {
    const { ctx, base } = contextFor();
    // This instance's own residue — what the sweep is here for.
    const residue = join(base, "orphan");
    await plantResidue(residue, "flume/orphan");
    // And a branch in the same ref namespace that no directory under this
    // base holds: a sibling checkout of this one repository provisioned it
    // under a base this instance cannot see, and both hold a tip claim of
    // their own. Nothing here removed a worktree for it, so nothing here may
    // remove it.
    await exec("git", ["branch", "flume/sibling-checkout", "HEAD"], {
      cwd: fx.repo,
    });

    // Vacuity pin: both branches stand going in, and the one the sweep owns
    // is really registered — so the survival below is judged beside a reap
    // that actually happened.
    expect(await flumeBranches(fx.repo)).toEqual([
      "flume/orphan",
      "flume/sibling-checkout",
    ]);
    expect(await registeredWorktrees(fx.repo)).toContain(residue);

    await sweepStaleWorktrees(ctx);

    expect(existsSync(residue)).toBe(false);
    expect(await flumeBranches(fx.repo)).toEqual(["flume/sibling-checkout"]);
  });
});

/**
 * WORKTREE-LONGPATHS-PIN-PRECEDES-ADD — the pin is a *precondition* of the
 * add, at both sites that plant a worktree under the base: `createWorktree`
 * for a tick's own tree and `checkoutAt` for a differential gate's detached
 * one. A pin issued after the add is a pin that did nothing for the operation
 * it exists to spare — `git worktree add` builds the deep path itself, and on
 * win32 it is that call, not a later one, that the MAX_PATH wall refuses.
 *
 * Both legs run the real provisioning against a real repo; only the two git
 * calls are wrapped, and they pass through (see the mock at the top of this
 * file). Off win32 `pinLongPaths` writes nothing, so the sequence — not the
 * resulting config value — is the observable, and it is the same sequence on
 * every host.
 */
describe("worktrees — the longpaths pin precedes the add", () => {
  let fx: Fixture;
  let head: string;
  let ctx: WorktreeContext;

  beforeEach(async () => {
    fx = await makeFixture();
    const { stdout } = await exec("git", ["rev-parse", "HEAD"], {
      cwd: fx.repo,
    });
    head = stdout.trim();
    ctx = {
      repoRoot: fx.repo,
      flumeDir: join(fx.repo, ".flume"),
      stateRootRel: ".flume",
      log: silent,
    };
    gitCalls.length = 0;
  });

  afterEach(async () => {
    await fx.cleanup();
  });

  it("createWorktree pins core.longpaths before it adds the worktree", async () => {
    const wt = await createWorktree("LONGPATHS-ORDER", head, ctx);

    // Vacuity (`.claude/rules/engineering.md`, "A green verdict is proven
    // non-vacuous"): the sequence below is judged over a worktree that really
    // got planted, so an ordering assertion over two calls that never
    // happened cannot read as green.
    expect(existsSync(wt.path)).toBe(true);
    expect(await registeredWorktrees(fx.repo)).toContain(wt.path);

    expect(gitCalls).toEqual(["pinLongPaths", "addWorktree"]);
  });

  it("checkoutAt pins core.longpaths before it adds its detached worktree", async () => {
    // The gate boundary the API is only reachable from, opened here the way
    // `runGate` (`src/gateRun.ts`) opens it around a real gate.
    const planted = await withGateCheckouts({ log: silent }, async () => {
      const path = await checkoutAt({
        repoRoot: fx.repo,
        flumeDir: ctx.flumeDir,
        sha: head,
      });

      // Same vacuity pin as the sibling leg, read inside the scope: the
      // checkout is reclaimed the moment this callback returns.
      expect(existsSync(path)).toBe(true);
      expect(await registeredWorktrees(fx.repo)).toContain(resolve(path));

      expect(gitCalls).toEqual(["pinLongPaths", "addWorktree"]);
      return path;
    });

    expect(existsSync(planted)).toBe(false);
  });
});

/**
 * THE-STARTUP-SWEEP-REMOVES-ONLY-ITS-OWN-STAMPED-WORKTREES — the sweep's
 * evidence is minted at provisioning, not inferred from the registry
 * (`spec/worktrees.md`, *Startup sweep — a dead wave's residue is removed at
 * the next start*). The registry names every worktree of the *repository*,
 * which is a wider claim than "this state root made it": a second checkout
 * of one repository holds a different tip, so its tip claim is grantable
 * beside this one, and under a shared base its live trees sit at exactly the
 * level the sweep reads. Removing one on the registry's word alone takes a
 * running sibling's worktree out from under it.
 *
 * Both sides of the seam are the real ones (`.claude/rules/engineering.md`,
 * *A seam gate reads what the real writer wrote*): `createWorktree` is the
 * writer whose stamp the real `sweepStaleWorktrees` reads back, and the
 * second state root's tree is provisioned through that same writer rather
 * than hand-stamped — a hand-authored stamp would agree with whatever the
 * sweep believed, including agreeing that there is no stamp at all.
 */
describe("worktrees — the startup sweep removes on the stamp provisioning minted", () => {
  let fx: Fixture;

  beforeEach(async () => {
    fx = await makeFixture();
  });

  afterEach(async () => {
    await fx.cleanup();
  });

  /** The fixture repo's current HEAD, the ref every provisioning branches from. */
  async function head(): Promise<string> {
    const { stdout } = await exec("git", ["rev-parse", "HEAD"], {
      cwd: fx.repo,
    });
    return stdout.trim();
  }

  /**
   * Two state roots over this repository, provisioning into one base — the
   * placement a sibling checkout sharing `FLUME_WORKTREES_DIR` produces, with
   * both roots' trees landing in the one registry each of them reads. The
   * base is declared on both contexts, so the pair share whichever base
   * resolution wins on this host.
   */
  function twoRoots(log: Logger): {
    own: WorktreeContext;
    sibling: WorktreeContext;
    base: string;
  } {
    const ownRoot = join(fx.repo, ".flume");
    const base = worktreesBase(ownRoot);
    return {
      own: {
        repoRoot: fx.repo,
        flumeDir: ownRoot,
        stateRootRel: ".flume",
        log,
        declaredWorktreesBase: base,
      },
      sibling: {
        repoRoot: fx.repo,
        flumeDir: join(fx.repo, ".flume-sibling"),
        stateRootRel: ".flume-sibling",
        log,
        declaredWorktreesBase: base,
      },
      base,
    };
  }

  it("provisioning stamps every worktree with the state root that created it", async () => {
    const { own } = twoRoots(silent);

    // A tick's own tree.
    const wt = await createWorktree("STAMP-AT-PROVISION", await head(), own);

    // Vacuity pin (`.claude/rules/engineering.md`, "A green verdict is proven
    // non-vacuous"): the worktree really was planted and really is
    // registered, so the stamp below is read off a live tree rather than
    // agreeing with an empty fixture.
    expect(existsSync(wt.path)).toBe(true);
    expect(await registeredWorktrees(fx.repo)).toContain(wt.path);

    expect(await stampAt(wt.path)).toBe(resolve(own.flumeDir));
    // And nowhere in the working tree: the tick's own clean-tree gate reads
    // this checkout, so a stamp the agent's commit would have to carry is a
    // stamp that breaks every tick.
    const { stdout: status } = await exec(
      "git",
      ["status", "--porcelain", "-z"],
      { cwd: wt.path },
    );
    expect(status).toBe("");

    // And a differential gate's detached tree, which plants at the same level
    // and is reclaimed by the same sweep when the run dies mid-gate.
    await withGateCheckouts(
      { log: silent, declaredWorktreesBase: own.declaredWorktreesBase! },
      async () => {
        const checkout = await checkoutAt({
          repoRoot: fx.repo,
          flumeDir: own.flumeDir,
          sha: await head(),
        });
        expect(await registeredWorktrees(fx.repo)).toContain(resolve(checkout));
        expect(await stampAt(checkout)).toBe(resolve(own.flumeDir));
      },
    );
  });

  /**
   * The 0.17 migration note tells an operator which file to look for when the
   * sweep declines a directory and a tick refuses an occupied path
   * (`docs/MIGRATING-0.17.md`, § 10) — a page stating what a shipped
   * interface writes, and so pinnable against that interface
   * (`.claude/rules/engineering.md`, *Narration is the ladder's bottom rung*).
   *
   * An agreement gate, not a literal comparison (*A seam gate reads what the
   * real writer wrote*): the real `createWorktree` provisions, and the stamp
   * is located by the one property the note claims for it — the file in git's
   * admin directory holding this state root — rather than by a name spelled
   * here. A rename of the writer's constant therefore reds the page that
   * still names the old file, which comparing two hand-written literals
   * could not.
   */
  it("the 0.17 migration note names the state-root stamp filename the worktree source writes", async () => {
    const { own } = twoRoots(silent);
    const wt = await createWorktree(
      "STAMP-FILENAME-IN-THE-NOTE",
      await head(),
      own,
    );

    const { stdout } = await exec("git", ["rev-parse", "--absolute-git-dir"], {
      cwd: wt.path,
    });
    const adminDir = stdout.trim();
    const stamps: string[] = [];
    for (const name of await readdir(adminDir)) {
      const file = join(adminDir, name);
      if (!(await lstat(file)).isFile()) continue;
      let text: string;
      try {
        text = await readFile(file, "utf8");
      } catch {
        continue;
      }
      if (text.trim() === resolve(own.flumeDir)) stamps.push(name);
    }

    // Vacuity pin (`.claude/rules/engineering.md`, *A green verdict is proven
    // non-vacuous*): exactly one file in git's admin directory holds this
    // state root, so the name asserted below is one the writer really wrote
    // and not an empty scan agreeing with any page at all.
    expect(stamps).toHaveLength(1);

    const note = await readFile(
      resolve(
        dirname(fileURLToPath(import.meta.url)),
        "..",
        "docs",
        "MIGRATING-0.17.md",
      ),
      "utf8",
    );
    expect(note).toContain(stamps[0]);
  });

  it("the startup sweep removes only worktree directories stamped by its own state root", async () => {
    const log = collectingLogger();
    const { own, sibling } = twoRoots(log);
    const ref = await head();

    // This root's abandoned residue: provisioned, then never torn down —
    // what a killed tick leaves.
    const ours = await createWorktree("SWEEP-OWN-RESIDUE", ref, own);
    // The second state root's tree, live and provisioned by the same writer.
    const theirs = await createWorktree("SWEEP-SIBLING-LIVE", ref, sibling);

    // Vacuity pin: both sit under the one base this sweep reads, both are
    // registered, and the two stamps differ — so the split asserted below is
    // a split, not two paths the registry never held.
    const registered = await registeredWorktrees(fx.repo);
    expect(registered).toContain(ours.path);
    expect(registered).toContain(theirs.path);
    expect(await stampAt(ours.path)).toBe(resolve(own.flumeDir));
    expect(await stampAt(theirs.path)).toBe(resolve(sibling.flumeDir));
    expect(await flumeBranches(fx.repo)).toEqual(
      [ours.branch, theirs.branch].sort(),
    );

    await sweepStaleWorktrees(own);

    // Its own residue, directory and branch alike.
    expect(existsSync(ours.path)).toBe(false);
    expect(await registeredWorktrees(fx.repo)).not.toContain(ours.path);

    // The sibling's live tree stands, still registered, still on its branch —
    // and the sweep says it left it.
    expect(existsSync(theirs.path)).toBe(true);
    expect(await registeredWorktrees(fx.repo)).toContain(theirs.path);
    expect(await flumeBranches(fx.repo)).toEqual([theirs.branch]);
    expect(
      log.warnings.filter((w) => w.includes(theirs.path)),
    ).toHaveLength(1);
  });

  it("the startup sweep leaves a registered directory carrying no stamp and names it once", async () => {
    const log = collectingLogger();
    const { own, base } = twoRoots(log);
    const ref = await head();

    // A registered worktree under this base that provisioning never stamped:
    // residue from a run that predates the stamp, or a sibling whose own
    // provisioning failed between the add and the stamp. The registry names
    // it exactly as it names this root's own trees.
    const unstamped = join(base, "unstamped");
    await mkdir(dirname(unstamped), { recursive: true });
    await exec(
      "git",
      ["worktree", "add", "-B", "flume/unstamped", unstamped, ref],
      { cwd: fx.repo },
    );
    // This root's own residue beside it — the sweep is still the sweep.
    const ours = await createWorktree("SWEEP-STAMPED-RESIDUE", ref, own);

    // Vacuity pin: git registers both, and exactly one of them carries a
    // stamp — so "left standing" below is a refusal rather than a path the
    // sweep never reached.
    const registered = await registeredWorktrees(fx.repo);
    expect(registered).toContain(resolve(unstamped));
    expect(registered).toContain(ours.path);
    expect(await stampAt(unstamped)).toBeUndefined();
    expect(await stampAt(ours.path)).toBe(resolve(own.flumeDir));

    await sweepStaleWorktrees(own);

    expect(existsSync(ours.path)).toBe(false);
    expect(existsSync(unstamped)).toBe(true);
    const after = await registeredWorktrees(fx.repo);
    expect(after).toContain(resolve(unstamped));
    expect(after).not.toContain(ours.path);
    // Its branch stays with it: the branch leg reaps what the directory leg
    // removed, and this directory was never removed.
    expect(await flumeBranches(fx.repo)).toEqual(["flume/unstamped"]);
    // Named once for the whole run, not once per directory.
    const named = log.warnings.filter((w) => w.includes(unstamped));
    expect(named).toHaveLength(1);
    expect(named[0]).toContain("no stamp from this state root");
  });
});
