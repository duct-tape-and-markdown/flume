/**
 * worktrees — the ephemeral worktree's own lifecycle: provisioning one for a
 * tick, tearing it down when the tick is over, and sweeping a dead run's
 * residue at the next start.
 *
 * Split out of `src/Dispatcher.ts` (`.claude/rules/posture-sweep.md`, "A
 * violation counts only when verified on disk this tick"): one directory
 * tree, one branch namespace, one naming rule — a job of its own, depending
 * on nothing the dispatcher holds beyond a repo root, a state root, that
 * root's relative path, an optional job namespace and a logger. The
 * dependency runs one way: the dispatcher calls in here, nothing here calls
 * back.
 *
 * Sibling to `src/setupWorktree.ts`, which owns the other half of the same
 * lifecycle — the lockfile-aware install a chain drops into its
 * `setupWorktree` hook, run by the dispatcher between
 * {@link createWorktree} and the agent.
 *
 * spec/worktrees.md is the contract these serve: "Where worktrees live",
 * "Singleton runs in a worktree", and "Startup sweep — a dead wave's
 * residue is removed at the next start".
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { execFile } from "node:child_process";
import { mkdir, readdir } from "node:fs/promises";
import { dirname, join, resolve, toNamespacedPath } from "node:path";
import { promisify } from "node:util";

import type { Logger } from "./Dispatcher.js";
import { harvestFriction } from "./friction.js";
import { existsLoud } from "./fsProbe.js";
import * as git from "./git.js";
import {
  boundedName,
  namespacedJoin,
  slugify,
  worktreesBase,
} from "./paths.js";
import type { Chain, Phase } from "./Phase.js";

const execFileP = promisify(execFile);

/**
 * What the worktree lifecycle needs from the dispatcher that drives it: the
 * primary repo root every git call runs against, the state root the worktree
 * base hangs off, that root's path relative to the repo root (`undefined`
 * when the state root is relocated outside it — spec/chain.md "What a gate
 * receives"), the job's branch/path namespace when it has one, and where to
 * log the failures this module swallows.
 *
 * One shape for all three entry points rather than three near-copies: they
 * are one job over one directory tree, and a context that splits per
 * function is how two roots drift apart. It is a superset of
 * `FrictionHarvestContext` (`src/friction.ts`), so
 * {@link teardownWorktreeInstance} hands the harvest this value directly
 * instead of rebuilding it.
 */
export interface WorktreeContext {
  repoRoot: string;
  flumeDir: string;
  stateRootRel: string | undefined;
  namespace: string | undefined;
  log: Logger;
  /**
   * `Chain.worktreesBase` already evaluated — the string the dispatcher got
   * back from the chain's declared computation at load, absent when the
   * chain declared none. Carried rather than re-evaluated here: the
   * declaration is a function, and a module that called it per worktree
   * would be a second evaluation of a value the engine already holds.
   * `worktreesBase` (`src/paths.ts`) decides what it outranks.
   */
  declaredWorktreesBase?: string;
}

/**
 * Length bound for `createWorktree`'s directory-name component only.
 * `git worktree add` refuses a worktree path around 200 chars on
 * win32 (`fatal: '$GIT_DIR' too big`) — below MAX_PATH, unaffected by
 * `core.longpaths`, and unreachable by `toNamespacedPath`/`namespacedJoin`
 * because git builds that path itself before any Node fs call sees it.
 * `TAG_MAX_LENGTH` (`PendingSchema.ts`) sizes the schema off NAME_MAX (255),
 * a wider ceiling, so a schema-valid tag's raw slug can already exceed this
 * one. Chosen with room to spare under a `wtBase`/namespace prefix, not
 * tuned to the measured ~200-char wall itself.
 */
const WORKTREE_DIRNAME_MAX = 48;

/**
 * `createWorktree`'s fs directory name for an entry's tag — `boundedName`
 * (`src/paths.ts`) against `WORKTREE_DIRNAME_MAX`, keyed on the *full* tag
 * so two tags sharing a long common prefix (or differing only where
 * `slugify` is lossy) still land on distinct directories. Only the
 * filesystem component is bounded: the branch name and the prior-attempt
 * key keep the untruncated `slugify(entry.tag)`, since neither is a git-
 * constructed worktree path and both are already bounded by the schema's
 * own `TAG_MAX_LENGTH`.
 */
export function worktreeDirName(tag: string): string {
  return boundedName(slugify(tag), WORKTREE_DIRNAME_MAX, tag);
}

/**
 * What `git worktree list --porcelain` said, reported as a fact rather than
 * as a set: `read: false` is "the registry could not be read", which is not
 * the claim "git registers no worktree at that path" and must never collapse
 * into it (`.claude/rules/engineering.md`, *Loud or nothing*). A caller about
 * to destroy a directory on the strength of an absence has to be able to tell
 * the two apart.
 */
export type WorktreeRegistry =
  | { read: true; paths: Set<string> }
  | { read: false; reason: string };

/**
 * The one probe of git's worktree registry, reached by every caller that
 * needs it: {@link createWorktree}'s removal of whatever occupies the path it
 * is about to provision, {@link sweepStaleWorktrees}'s choice of which
 * top-level directories are this job's residue, and — handed out as
 * `FlumeApi.git.readWorktreeRegistry` — a chain reclaiming whatever it
 * allocated per worktree. All ask the identical question — *is this path one
 * git calls a worktree of this repo?* — and a second spelling beside the
 * first is how one of them comes to answer it from the directory's name
 * instead (`.claude/rules/engineering.md`, *The fix lands at the mechanism*:
 * detection a sibling surface already performs is shared, never re-derived).
 * A chain listing the worktree base for the same answer is that second
 * spelling one package boundary out (`.claude/rules/engine-boundary.md`,
 * *Surface, not prescription*: a hook receives facts, never re-derives them),
 * and the directory cannot answer it — a relocated base, a sibling job's
 * container directory and residue whose registration git already pruned all
 * read the same there.
 *
 * Every path git names is reported, the primary checkout included: this is
 * git's list, not a list of the engine's own residue. Which of those paths a
 * caller owns is the caller's to decide.
 *
 * Paths are resolved absolute before they enter the set: git prints its own
 * absolute spelling, which need not match a caller's character for character.
 *
 * `-z` is the form that can carry those paths: `--porcelain` alone separates
 * its fields by newline and never escapes the path, so a worktree whose path
 * holds a newline arrives split across two records and a trailing-space path
 * arrives trimmed — each a *different* path silently entering the set in
 * place of the one git named (`.claude/rules/engineering.md`, *Loud or
 * nothing*), and every caller here judges membership by exact match: an
 * occupied path the mangled spelling misses is refused as a directory git
 * does not own, and residue the sweep would have removed is left standing.
 * Under `-z` every field is NUL-terminated instead, so the path is whatever
 * lies between the `worktree ` prefix and the next NUL, verbatim. (`-z` for
 * `worktree list` needs git >= 2.36.)
 */
export async function readWorktreeRegistry(
  repoRoot: string,
): Promise<WorktreeRegistry> {
  let stdout: string;
  try {
    ({ stdout } = await execFileP(
      "git",
      ["worktree", "list", "--porcelain", "-z"],
      {
        cwd: repoRoot,
        maxBuffer: 16 * 1024 * 1024,
      },
    ));
  } catch (err) {
    return { read: false, reason: (err as Error).message };
  }
  const paths = new Set<string>();
  for (const field of stdout.split("\0")) {
    if (field.startsWith("worktree ")) {
      paths.add(resolve(field.slice("worktree ".length)));
    }
  }
  return { read: true, paths };
}

/**
 * One checkout {@link checkoutAt} planted, and the repo it was registered
 * against — the pair {@link withGateCheckouts} needs to hand it back. The
 * repo travels with the path rather than being re-read off the reclaiming
 * context: a gate is free to ask for a tree of some repo other than its own
 * `repoRoot`, and reclamation keyed on the reclaimer's guess would then run
 * `git worktree remove` against a repo that never registered the path.
 */
interface PlantedCheckout {
  repoRoot: string;
  path: string;
}

/**
 * What a gate's checkout scope takes from the dispatcher that opens it: the
 * two placement facts that decide where {@link checkoutAt} plants — the
 * chain's already-evaluated worktree base and this job's namespace — and the
 * logger the reclamation's swallowed failures go to.
 *
 * Both placement facts ride the scope rather than `checkoutAt`'s own `opts`
 * because that caller is the *gate* — a chain hook, which cannot be asked
 * for a value the engine evaluated for it without re-deriving it
 * (`.claude/rules/engine-boundary.md`, *Surface, not prescription*: a hook
 * receives facts, never re-derives them). The dispatcher knows both, and the
 * gate boundary it already opens is where it hands them over.
 *
 * A subset of {@link WorktreeContext} rather than a shape of its own, so the
 * dispatcher passes the context it already composes instead of a second copy
 * of three of its fields (`.claude/rules/engineering.md`, *Derived state is
 * computed, never restated beside its source*). `repoRoot` and `flumeDir`
 * are deliberately off it: those come from the *gate's* own context at each
 * `checkoutAt` call, since a gate is free to ask for a tree of some repo
 * other than the dispatcher's.
 */
type GateCheckoutContext = Pick<
  WorktreeContext,
  "log" | "namespace" | "declaredWorktreesBase"
>;

/**
 * One gate invocation's checkout scope: where it plants, plus the ledger of
 * what it planted.
 */
interface GateCheckoutScope extends GateCheckoutContext {
  planted: PlantedCheckout[];
}

/**
 * The in-flight gate invocation's checkout scope. Async-local rather than
 * module-global because gate invocations overlap: a fanout wave runs its
 * entries concurrently (`Dispatcher.runFanout`), so a single shared list
 * would hand one gate's reclamation another gate's live tree. The store is
 * entered once per gate run by {@link withGateCheckouts} and propagates
 * through every `await` the gate makes, which is exactly the scope
 * `spec/chain.md` ("What a gate receives") promises the checkout lives for.
 */
const gateCheckouts = new AsyncLocalStorage<GateCheckoutScope>();

/** Disambiguates two checkouts of the same sha in one process. */
let checkoutSeq = 0;

/**
 * A detached checkout of `sha`, planted under the state root's worktree base
 * and reclaimed by the engine when the gate that asked for it returns
 * (`spec/chain.md`, *What a gate receives*) — the tree at a sha, for a
 * differential gate that needs to run something in it rather than read one
 * file out of it.
 *
 * **Under the worktree base, not a temp dir.** A run killed between the add
 * and the reclamation leaves a directory git registers as a worktree at the
 * exact level {@link sweepStaleWorktrees} reads at the next start, so the
 * residue is reclaimed by machinery that already exists rather than
 * accumulating somewhere nothing looks. Under a job namespace that level is
 * `<base>/<namespace>`, so the checkout carries the namespace exactly as
 * {@link createWorktree}'s path does: planting at the bare base under a
 * namespaced job lands the residue one level above the only sweep that would
 * read it, on the level that sweep steps over as a sibling job's.
 *
 * **Detached, so there is no ref to clean up**: nothing commits here, and a
 * branch would be a second thing the reclamation could fail to remove.
 *
 * Refuses outside a gate invocation rather than handing back a tree nothing
 * will reclaim (`.claude/rules/engineering.md`, *Loud or nothing*): the
 * removal this promises is the engine's, and off the gate path there is no
 * "when the gate returns" for it to happen at. Gate-time is the contract,
 * not a restriction with a way around it — a base checkout is what a gate
 * asks the engine for and what the engine reclaims when that gate returns,
 * and nothing drives one from outside a gate invocation (`spec/harness.md`,
 * *The runner interface*).
 */
export async function checkoutAt(opts: {
  /** The repo to check out from — a gate's own `repoRoot`. */
  repoRoot: string;
  /** The state root whose worktree base the checkout lands under — a gate's `flumeDir`. */
  flumeDir: string;
  /** The sha to check out, detached — a differential gate's `baseSha`. */
  sha: string;
}): Promise<string> {
  const scope = gateCheckouts.getStore();
  if (!scope) {
    throw new Error(
      `checkoutAt: no gate invocation is in flight, so nothing would remove a checkout of ${opts.sha}; ` +
        `this API is reclaimed by the engine at the gate boundary and is not available outside one`,
    );
  }
  // One resolution for the base, shared with `createWorktree` and the
  // startup sweep (`worktreesBase`, src/paths.ts) — the chain's declared
  // base included, taken from the gate scope the dispatcher opened rather
  // than from the gate that called in here.
  const base = worktreesBase(opts.flumeDir, scope.declaredWorktreesBase);
  // Namespaced exactly as `createWorktree`'s path is, from the same value:
  // `sweepStaleWorktrees` reads `<base>/<namespace>` when a namespace is
  // set, and treats a directory at the bare base as a sibling job's to leave
  // standing. Unconditional when set — the redundant level under a
  // per-job default base is harmless, as it is there.
  const dir = scope.namespace ? join(base, scope.namespace) : base;
  const path = join(
    dir,
    `checkout-${opts.sha.slice(0, 7)}-${process.pid}-${checkoutSeq++}`,
  );
  await mkdir(toNamespacedPath(dir), { recursive: true });
  // Same win32 MAX_PATH gap `createWorktree` pins for: this lands at the
  // same depth its siblings do.
  await git.pinLongPaths(opts.repoRoot);
  // Recorded before the add, not after: an add that fails partway through
  // still leaves a directory, and a ledger written only on success would
  // leave it standing.
  scope.planted.push({ repoRoot: opts.repoRoot, path });
  await git.addWorktree({ repoRoot: opts.repoRoot, path, fromRef: opts.sha });
  return path;
}

/**
 * Run one gate invocation as the reclamation scope for whatever
 * {@link checkoutAt} plants inside it — `Dispatcher.runGate` is the one
 * gate-run site and so the one place this wraps
 * (`.claude/rules/engineering.md`, *The fix lands at the mechanism*).
 *
 * Reclaims on both legs: the `finally` runs whether the gate returned a
 * verdict or threw, because a gate that crashed mid-differential is the case
 * most likely to leave a tree behind. Most-recent-first, so a checkout
 * planted inside another's lifetime goes first.
 *
 * A removal that fails is logged and swallowed, never propagated: the gate's
 * verdict is the tick's fact, and losing it to a locked handle in the
 * cleanup would convert dead residue into a lost tick. What survives is
 * registered under the worktree base, which is where the next start's sweep
 * looks.
 */
export async function withGateCheckouts<T>(
  ctx: GateCheckoutContext,
  body: () => Promise<T>,
): Promise<T> {
  const planted: PlantedCheckout[] = [];
  try {
    return await gateCheckouts.run({ ...ctx, planted }, body);
  } finally {
    for (const c of planted.reverse()) {
      try {
        await git.removeWorktree(c.repoRoot, c.path);
      } catch (err) {
        ctx.log.warn(
          `[flume] could not reclaim the gate checkout at ${c.path}: ${(err as Error).message}`,
        );
      }
    }
  }
}

/**
 * Provision one worktree, branched `flume/[<namespace>/]<tag>` from
 * `fromRef`. Shared by fanout (`tag` = the entry's own tag) and singleton
 * (`tag` = the phase name — a singleton tick has no entry; spec/worktrees.md
 * "Singleton runs in a worktree" keys its worktree on the phase instead).
 * Both directory-name length-bounding and job-namespace scoping apply
 * identically either way — the caller supplies the identifier, this
 * function doesn't care what it names.
 */
export async function createWorktree(
  tag: string,
  fromRef: string,
  ctx: WorktreeContext,
): Promise<{ path: string; branch: string }> {
  const slug = slugify(tag);
  // Job-scoped branch namespace: with a namespace, identical slugs across
  // jobs land on disjoint branches; without one, the repo-global name
  // stands (bare `.flume` harnesses unchanged).
  const branch = ctx.namespace
    ? `flume/${ctx.namespace}/${slug}`
    : `flume/${slug}`;
  // One resolution for the base, shared with the startup sweep
  // (`worktreesBase`, src/paths.ts — which is also where the override's
  // stray-write rationale lives, and where a chain's declared base is
  // ranked against it).
  const wtBase = worktreesBase(ctx.flumeDir, ctx.declaredWorktreesBase);
  // The path mirrors the branch namespacing: under a shared
  // FLUME_WORKTREES_DIR two jobs with identical slugs would otherwise
  // collide on <base>/<dirName>, and the stale-cleanup below would rm the
  // OTHER job's live worktree. Namespaced unconditionally when set — the
  // redundant level under a default per-job base is harmless.
  //
  // The fs directory name is length-bounded — git itself refuses a
  // worktree path around 200 chars on win32, below `TAG_MAX_LENGTH`'s
  // NAME_MAX-derived ceiling — while `branch` above keeps the untruncated
  // slug: `tag` stays full-length everywhere except this one directory
  // component. A phase name takes the same bound an entry tag does.
  const dirName = worktreeDirName(tag);
  const path = ctx.namespace
    ? join(wtBase, ctx.namespace, dirName)
    : join(wtBase, dirName);
  // Absent is the only silent reading: `existsLoud` (src/fsProbe.ts) throws
  // on a path that is present but unstattable, where `existsSync` read it as
  // free and provisioned straight over it — skipping the registry judgment
  // below, which is the whole defence against clobbering a directory git
  // does not own.
  if (existsLoud(toNamespacedPath(path))) {
    // Occupied. Whether that is this job's own stale worktree from a crashed
    // run is git's registry to answer, never the path's existence: a
    // directory git disclaims is as easily a sibling namespaced job's
    // container directory under a shared FLUME_WORKTREES_DIR, or an
    // operator's own tree, and removing one of those is the clobber the
    // startup sweep below already refuses on exactly this evidence. Anything
    // git does not name is refused loudly and left standing for an operator
    // to judge — the cost is that residue whose registration was already
    // pruned needs a hand, which is the trade the sweep took.
    const registry = await readWorktreeRegistry(ctx.repoRoot);
    if (!registry.read) {
      throw new Error(
        `worktree path is occupied and the git worktree registry could not be read (${registry.reason}); refusing to remove a directory git may not own: ${path}`,
      );
    }
    if (!registry.paths.has(resolve(path))) {
      throw new Error(
        `worktree path is occupied by a directory git does not register as a worktree of ${ctx.repoRoot}; refusing to remove it — clear it by hand if it is flume residue: ${path}`,
      );
    }
    await git.removeWorktree(ctx.repoRoot, path);
  }
  await mkdir(toNamespacedPath(dirname(path)), { recursive: true });
  // Fanout worktrees nest at least as deep as the job dir they're cloned
  // for — the identical win32 MAX_PATH gap job.ts's own baseline pin
  // exists to spare.
  await git.pinLongPaths(ctx.repoRoot);
  await git.addWorktree({
    repoRoot: ctx.repoRoot,
    path,
    branch,
    fromRef,
  });
  return { path, branch };
}

/**
 * Tear down one worktree: the chain's best-effort `teardownWorktree` hook,
 * the friction harvest, removal, then branch deletion — the exact
 * per-worktree sequence `runFanout`'s wave-end cleanup loop ran inline,
 * now shared with a singleton tick's own single worktree
 * (spec/worktrees.md "Singleton runs in a worktree"). `tag` is the entry's
 * tag or the phase name, passed straight through to the hook's `worktreeKey`
 * and to the harvest's provenance prefix. Returns whether removal succeeded —
 * the caller aggregates surviving paths itself, since a wave reports them
 * once at wave level, not once per worktree.
 */
export async function teardownWorktreeInstance(
  phase: Phase,
  chain: Chain,
  wt: { path: string; branch: string },
  tag: string,
  ctx: WorktreeContext,
): Promise<boolean> {
  if (phase.teardownWorktree) {
    try {
      await phase.teardownWorktree({
        worktreePath: wt.path,
        repoRoot: ctx.repoRoot,
        worktreeKey: tag,
      });
    } catch (err) {
      ctx.log.warn(
        `[flume] teardownWorktree failed for ${wt.path}: ${(err as Error).message}`,
      );
    }
  }
  await harvestFriction(chain, wt.path, tag, ctx);
  let removed = false;
  try {
    await git.removeWorktree(ctx.repoRoot, wt.path);
    removed = true;
  } catch {
    // Caller records the surviving path.
  }
  try {
    await git.deleteBranch(ctx.repoRoot, wt.branch);
  } catch (err) {
    ctx.log.warn(
      `[flume] deleteBranch failed for ${wt.branch}: ${(err as Error).message}`,
    );
  }
  return removed;
}

/**
 * Startup sweep (`spec/worktrees.md`, "Startup sweep — a dead wave's
 * residue is removed at the next start"): a killed fanout tick abandons
 * its worktrees and their `flume/**` branches — teardown never ran, and
 * per-wave stale-slug removal ({@link createWorktree} above) only ever covers
 * an entry being re-provisioned, never one that left the queue entirely.
 * `flume loop` / `flume job run` call this once through
 * `Dispatcher.sweepStaleWorktrees`, after the tip claim is
 * acquired and before the first tick (`src/cli.ts`) — holding the claim
 * is the guard: one flume writer per ref means no live sibling owns
 * anything under this state root's worktree base. A bare `flume tick`
 * never calls this; its per-wave prune and stale-slug removal are
 * unchanged.
 *
 * Scope is exactly the engine's own residue: every directory directly
 * under the worktree base — the same `worktreesBase` (`src/paths.ts`)
 * `createWorktree` provisions into, namespace-scoped the same way its
 * path is when a namespace is set. Without one,
 * `sweepBase` is the bare worktrees dir, which a shared
 * `FLUME_WORKTREES_DIR` also holds every *namespaced* sibling job's
 * container directory (`<wtBase>/<their-namespace>/`) at that exact same
 * top level — an arbitrary operator-chosen string, indistinguishable by
 * name alone from one of this job's own bounded `dirName` entries. So a
 * bare `readdir` + blind removal would delete a live sibling's entire
 * worktree tree the first time its container directory sits at this
 * level. The disambiguator is git's own registry, not a naming
 * heuristic (`.claude/rules/engine-boundary.md`, "told, not inferred"):
 * {@link readWorktreeRegistry} — the same probe {@link createWorktree}
 * clears an occupied path on — names every path git currently considers a
 * worktree, and only entries that are literally one of those paths are
 * this job's own residue to remove through `git.removeWorktree` +
 * win32-fallback (the same path teardown uses) — a sibling's container
 * directory was never itself registered as a worktree, only the paths
 * nested inside it are, so it is left untouched. Then a final `git
 * worktree prune`; then every branch matching this instance's own
 * `flume/[<namespace>/]…` grammar. Branch matching uses `for-each-ref`'s
 * one-level glob (`flume/*` matches `flume/foo`, never `flume/ns/foo`)
 * rather than `branch --list`'s pattern, whose `*` crosses `/` — the
 * non-namespaced case must not sweep a namespaced sibling job's branches
 * sharing the same repo.
 *
 * Never throws: an unreadable or absent base, an unreadable registry, a
 * surviving worktree directory (locked handle, EBUSY), a prune failure, or a
 * branch that won't delete are each logged and swallowed rather than
 * propagated — a sweep that could abort the run would convert dead residue
 * into a denial of service on the live queue. Silent on an absent or empty
 * base, the normal case; a surviving worktree path is warned once for
 * the whole run, not once per directory. A registry the probe could not read
 * removes nothing and says so: an unreadable registry is not a base with
 * nothing registered in it, and the two must not print the same silence.
 */
export async function sweepStaleWorktrees(
  ctx: WorktreeContext,
): Promise<void> {
  const repoRoot = ctx.repoRoot;
  const wtBase = worktreesBase(ctx.flumeDir, ctx.declaredWorktreesBase);
  const sweepBase = ctx.namespace
    ? join(wtBase, ctx.namespace)
    : wtBase;

  let entries: string[];
  try {
    entries = await readdir(namespacedJoin(sweepBase));
  } catch (err) {
    // Absent base is the normal, silent case. Anything else (e.g.
    // permissions) is logged but never aborts the run.
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      ctx.log.warn(
        `[flume] startup sweep: could not read ${sweepBase}: ${(err as Error).message}`,
      );
    }
    return;
  }

  // Which top-level entries are actually this job's own worktrees, as
  // opposed to a sibling namespaced job's container directory sitting at
  // the same level under a shared FLUME_WORKTREES_DIR: git's own registry,
  // not the entry's name. A container directory was never itself `git
  // worktree add`ed, so it never appears here — only the paths nested
  // inside it do.
  const registry = await readWorktreeRegistry(repoRoot);
  if (!registry.read) {
    // An unreadable registry is not an empty one. With no way to tell this
    // job's residue from a live sibling's tree, the sweep removes nothing —
    // and reports that it removed nothing, rather than leaving a silent
    // no-op that reads exactly like a clean base.
    ctx.log.warn(
      `[flume] startup sweep: could not read the worktree registry (${registry.reason}); removed no worktree directories`,
    );
  }

  const survivingPaths: string[] = [];
  if (registry.read) {
    for (const name of entries) {
      const path = join(sweepBase, name);
      if (!registry.paths.has(resolve(path))) {
        // Not a worktree git knows about — most commonly a sibling
        // namespaced job's container directory. Not this job's residue;
        // leave it untouched.
        continue;
      }
      try {
        await git.removeWorktree(repoRoot, path);
      } catch {
        survivingPaths.push(path);
      }
    }
  }
  try {
    await git.pruneWorktrees(repoRoot);
  } catch (err) {
    ctx.log.warn(
      `[flume] startup sweep: worktree prune failed: ${(err as Error).message}`,
    );
  }

  const branchPattern = ctx.namespace
    ? `flume/${ctx.namespace}/*`
    : "flume/*";
  let branches: string[] = [];
  try {
    const { stdout } = await execFileP(
      "git",
      [
        "for-each-ref",
        "--format=%(refname:short)",
        `refs/heads/${branchPattern}`,
      ],
      { cwd: repoRoot, maxBuffer: 16 * 1024 * 1024 },
    );
    branches = stdout
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
  } catch (err) {
    ctx.log.warn(
      `[flume] startup sweep: could not list ${branchPattern} branches: ${(err as Error).message}`,
    );
  }
  for (const branch of branches) {
    try {
      await git.deleteBranch(repoRoot, branch);
    } catch (err) {
      ctx.log.warn(
        `[flume] startup sweep: deleteBranch failed for ${branch}: ${(err as Error).message}`,
      );
    }
  }

  if (survivingPaths.length > 0) {
    ctx.log.warn(
      `[flume] startup sweep: ${survivingPaths.length} worktree(s) survived removal (fallback exhausted): ${survivingPaths.join(", ")}`,
    );
  }
}
