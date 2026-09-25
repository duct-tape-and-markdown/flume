/**
 * worktrees — the ephemeral worktree's own lifecycle: provisioning one for a
 * tick, tearing it down when the tick is over, and sweeping a dead run's
 * residue at the next start.
 *
 * Split out of `src/Dispatcher.ts` (`.claude/rules/posture-sweep.md`, "A
 * violation counts only when verified on disk this tick"): one directory
 * tree, one branch namespace, one naming rule — a job of its own, depending
 * on nothing the dispatcher holds beyond a repo root, a state root, that
 * root's relative path and a logger. The dependency runs one way: the
 * dispatcher calls in here, nothing here calls back.
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
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve, toNamespacedPath } from "node:path";

import type { Logger } from "./log.js";
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

/**
 * What the worktree lifecycle needs from the dispatcher that drives it: the
 * primary repo root every git call runs against, the state root the worktree
 * base hangs off, that root's path relative to the repo root (`undefined`
 * when the state root is relocated outside it — spec/chain.md "What a gate
 * receives"), and where to log the failures this module swallows.
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
 * one. Chosen with room to spare under a `wtBase` prefix, not tuned to the
 * measured ~200-char wall itself.
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
 * as a map: `read: false` is "the registry could not be read", which is not
 * the claim "git registers no worktree at that path" and must never collapse
 * into it (`.claude/rules/engineering.md`, *Loud or nothing*). A caller about
 * to destroy a directory on the strength of an absence has to be able to tell
 * the two apart.
 *
 * `worktrees` keys every registered path — membership is `has`, as it was
 * when this carried a set — and values the branch that path is checked out
 * on, `undefined` for a detached one ({@link checkoutAt}'s gate tree is the
 * engine's own). One container rather than a path set beside a branch map:
 * the pairing is what git printed, and two copies of one record is the
 * restatement a caller reconciles by hand
 * (`.claude/rules/engineering.md`, *Derived state is computed, never restated
 * beside its source*).
 *
 * The branch is named in the short spelling every other branch on this
 * surface is — `flume/<slug>`, what {@link createWorktree} returns and what
 * `git.deleteBranch` (`src/git.ts`) takes — not the `refs/heads/…` ref git
 * prints it as.
 */
export type WorktreeRegistry =
  | { read: true; worktrees: ReadonlyMap<string, string | undefined> }
  | { read: false; reason: string };

/** The porcelain field naming a record's worktree path. */
const WORKTREE_FIELD = "worktree ";

/**
 * The porcelain field naming the branch a record is checked out on, through
 * the `refs/heads/` prefix git always spells it with — so the short name is
 * what lies past this prefix, with no second decode to disagree with it. A
 * detached record carries `detached` instead and matches nothing here.
 */
const BRANCH_FIELD = "branch refs/heads/";

/**
 * The file `stampWorktree` writes inside a worktree's own git admin
 * directory, naming the state root that provisioned it.
 *
 * **Inside the admin directory, not the working tree.** A tick's own
 * clean-tree gate reads the worktree it runs in, so a stamp dropped in the
 * checkout would be the tick's first uncommitted file. `.git/worktrees/<name>/`
 * is git's per-worktree scratch, invisible to `status`, and git removes it
 * with the worktree — `worktree remove` and `worktree prune` alike — so the
 * stamp has exactly the lifetime of the thing it describes and no reaper of
 * its own.
 */
const STATE_ROOT_STAMP = "flume-state-root";

/**
 * Record which state root provisioned the worktree at `worktreePath` — the
 * evidence {@link sweepStaleWorktrees} removes on (`spec/worktrees.md`,
 * *Startup sweep — a dead wave's residue is removed at the next start*),
 * and the same evidence {@link createWorktree} clears an occupied path on
 * (*Placement — the worktree base*).
 *
 * The registry alone cannot carry that claim. It names every worktree of the
 * *repository*, and a second checkout of one repository holds a different tip
 * and is therefore grantable a tip claim of its own, so two live flume
 * instances can share one worktree base (*Placement*) and each read the
 * other's live trees as its own residue. The tip claim guards this state
 * root's worktrees and says nothing about a sibling's, so the sweep's
 * evidence is minted at provisioning rather than inferred from a registry
 * entry.
 *
 * Both sites that plant under the base stamp — {@link createWorktree} for a
 * tick's tree and {@link checkoutAt} for a differential gate's detached one —
 * because the sweep is the only reclamation either has when the run dies, and
 * an unstamped tree is one the sweep will decline forever.
 *
 * Exported for the suites that plant a dead run's residue: the sweep's claim
 * is that the two sides of this seam agree, which a hand-written stamp beside
 * it could not show (`.claude/rules/engineering.md`, *A seam gate reads what
 * the real writer wrote*).
 *
 * A failure here propagates. It is the caller's provisioning failure, isolated
 * the way any other is (`spec/worktrees.md`, *Every `.git/worktrees` mutation
 * is serialized; the agent fanout is not*), rather than a worktree that reads
 * as provisioned while nothing will ever reclaim it
 * (`.claude/rules/engineering.md`, *Loud or nothing*).
 */
export async function stampWorktree(
  worktreePath: string,
  flumeDir: string,
): Promise<void> {
  const adminDir = await git.absoluteGitDir(worktreePath);
  await writeFile(
    namespacedJoin(adminDir, STATE_ROOT_STAMP),
    `${resolve(flumeDir)}\n`,
    "utf8",
  );
}

/**
 * The state root that stamped the worktree at `worktreePath`, or `undefined`
 * where none did — read by both sides that would destroy a directory under
 * the base: {@link sweepStaleWorktrees} deciding a dead run's residue, and
 * {@link createWorktree} deciding an occupied path. One read for both, so the
 * two cannot come to disagree about what counts as this root's tree
 * (`.claude/rules/engineering.md`, *The fix lands at the mechanism*).
 *
 * Every failure reads as "no stamp": an admin directory git will not name, an
 * absent or unreadable file, a file holding nothing. None of them is this
 * root's evidence, and both callers' verdict on all of them is identical —
 * leave the directory standing and say so. The refusal is the floor here,
 * not a degradation: the one action a missing stamp permits is the one that
 * destroys nothing, and each caller says out loud what it left — the sweep in
 * a warning, provisioning by failing the tick that named the path.
 */
async function stampedStateRoot(
  worktreePath: string,
): Promise<string | undefined> {
  let text: string;
  try {
    const adminDir = await git.absoluteGitDir(worktreePath);
    text = await readFile(namespacedJoin(adminDir, STATE_ROOT_STAMP), "utf8");
  } catch {
    return undefined;
  }
  const stamp = text.trim();
  return stamp.length > 0 ? stamp : undefined;
}

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
 * Every path git names is reported with the branch git names beside it, the
 * primary checkout included: this is git's list, not a list of the engine's
 * own residue. Which of those worktrees a caller owns is the caller's to
 * decide — the startup sweep's branch leg owns exactly the ones whose
 * directories it removed, and it reads the pairing here rather than reaping
 * by branch name, which would name a sibling checkout's live branch too.
 *
 * Paths are resolved absolute before they enter the map: git prints its own
 * absolute spelling, which need not match a caller's character for character.
 *
 * `-z` is the form that can carry those paths: `--porcelain` alone separates
 * its fields by newline and never escapes the path, so a worktree whose path
 * holds a newline arrives split across two records and a trailing-space path
 * arrives trimmed — each a *different* path silently entering the map in
 * place of the one git named (`.claude/rules/engineering.md`, *Loud or
 * nothing*), and every caller here judges membership by exact match: an
 * occupied path the mangled spelling misses is refused as a directory git
 * does not own, and residue the sweep would have removed is left standing.
 * Under `-z` every field is NUL-terminated instead, so the path is whatever
 * lies between the `worktree ` prefix and the next NUL, verbatim.
 */
export async function readWorktreeRegistry(
  repoRoot: string,
): Promise<WorktreeRegistry> {
  let stdout: string;
  try {
    stdout = await git.worktreeListPorcelain(repoRoot);
  } catch (err) {
    return { read: false, reason: (err as Error).message };
  }
  const worktrees = new Map<string, string | undefined>();
  // One record per worktree, `worktree <path>` first and its remaining
  // fields after, so the path most recently seen is the one a `branch` field
  // belongs to. A `branch` field ahead of any record is a shape git does not
  // print and pairs with nothing.
  let current: string | undefined;
  for (const field of stdout.split("\0")) {
    if (field.startsWith(WORKTREE_FIELD)) {
      current = resolve(field.slice(WORKTREE_FIELD.length));
      worktrees.set(current, undefined);
    } else if (current !== undefined && field.startsWith(BRANCH_FIELD)) {
      worktrees.set(current, field.slice(BRANCH_FIELD.length));
    }
  }
  return { read: true, worktrees };
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
 * placement fact that decides where {@link checkoutAt} plants — the chain's
 * already-evaluated worktree base — and the logger the reclamation's
 * swallowed failures go to.
 *
 * The placement fact rides the scope rather than `checkoutAt`'s own `opts`
 * because that caller is the *gate* — a chain hook, which cannot be asked
 * for a value the engine evaluated for it without re-deriving it
 * (`.claude/rules/engine-boundary.md`, *Surface, not prescription*: a hook
 * receives facts, never re-derives them). The dispatcher knows it, and the
 * gate boundary it already opens is where it hands it over.
 *
 * A subset of {@link WorktreeContext} rather than a shape of its own, so the
 * dispatcher passes the context it already composes instead of a second copy
 * of two of its fields (`.claude/rules/engineering.md`, *Derived state is
 * computed, never restated beside its source*). `repoRoot` and `flumeDir`
 * are deliberately off it: those come from the *gate's* own context at each
 * `checkoutAt` call, since a gate is free to ask for a tree of some repo
 * other than the dispatcher's.
 */
type GateCheckoutContext = Pick<
  WorktreeContext,
  "log" | "declaredWorktreesBase"
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
 * entries concurrently (`runFanout`, `src/waveTick.ts`), so a single shared list
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
 * accumulating somewhere nothing looks. That level is the base itself — the
 * engine mints no level beneath it (`spec/worktrees.md`, *Placement — the
 * worktree base*) — so the checkout plants exactly where
 * {@link createWorktree}'s path does.
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
  const path = join(
    base,
    `checkout-${opts.sha.slice(0, 7)}-${process.pid}-${checkoutSeq++}`,
  );
  await mkdir(toNamespacedPath(base), { recursive: true });
  // Same win32 MAX_PATH gap `createWorktree` pins for: this lands at the
  // same depth its siblings do.
  await git.pinLongPaths(opts.repoRoot);
  // Recorded before the add, not after: an add that fails partway through
  // still leaves a directory, and a ledger written only on success would
  // leave it standing.
  scope.planted.push({ repoRoot: opts.repoRoot, path });
  await git.addWorktree({
    repoRoot: opts.repoRoot,
    path,
    fromRef: opts.sha,
    log: scope.log,
  });
  // Stamped like any other tree planted under the base: the gate boundary
  // reclaims this one, but a run killed mid-gate leaves it for the next
  // start's sweep, which removes only what its own state root stamped.
  await stampWorktree(path, opts.flumeDir);
  return path;
}

/**
 * Run one gate invocation as the reclamation scope for whatever
 * {@link checkoutAt} plants inside it — `runGate` (`src/gateRun.ts`) is the
 * one gate-run site and so the one place this wraps
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
        await git.removeWorktree(c.repoRoot, c.path, ctx.log);
      } catch (err) {
        ctx.log.warn(
          `[flume] could not reclaim the gate checkout at ${c.path}: ${(err as Error).message}`,
        );
      }
    }
  }
}

/**
 * Provision one worktree, branched `flume/<tag>` from `fromRef`. Shared by
 * fanout (`tag` = the entry's own tag) and singleton (`tag` = the phase
 * name — a singleton tick has no entry; spec/worktrees.md "Singleton runs in
 * a worktree" keys its worktree on the phase instead). Directory-name
 * length-bounding applies identically either way — the caller supplies the
 * identifier, this function doesn't care what it names.
 */
export async function createWorktree(
  tag: string,
  fromRef: string,
  ctx: WorktreeContext,
): Promise<{ path: string; branch: string }> {
  const slug = slugify(tag);
  const branch = `flume/${slug}`;
  // One resolution for the base, shared with the startup sweep
  // (`worktreesBase`, src/paths.ts — which is also where the override's
  // stray-write rationale lives, and where a chain's declared base is
  // ranked against it).
  const wtBase = worktreesBase(ctx.flumeDir, ctx.declaredWorktreesBase);
  // The engine mints no level beneath the base (`spec/worktrees.md`,
  // *Placement — the worktree base*): two efforts are two checkouts, each
  // with its own state root and so its own base, and a base an operator
  // deliberately shares between checkouts collides loudly at the registry
  // judgment below rather than quietly.
  //
  // The fs directory name is length-bounded — git itself refuses a
  // worktree path around 200 chars on win32, below `TAG_MAX_LENGTH`'s
  // NAME_MAX-derived ceiling — while `branch` above keeps the untruncated
  // slug: `tag` stays full-length everywhere except this one directory
  // component. A phase name takes the same bound an entry tag does.
  const dirName = worktreeDirName(tag);
  const path = join(wtBase, dirName);
  // Absent is the only silent reading: `existsLoud` (src/fsProbe.ts) throws
  // on a path that is present but unstattable, where `existsSync` read it as
  // free and provisioned straight over it — skipping the registry judgment
  // below, which is the whole defence against clobbering a directory git
  // does not own.
  if (existsLoud(toNamespacedPath(path))) {
    // Occupied. Whether that is this job's own stale worktree from a crashed
    // run is decided on the same two pieces of evidence
    // {@link sweepStaleWorktrees} decides on, never the path's existence,
    // because the two are one judgment over one directory tree reached from
    // two moments (`.claude/rules/engineering.md`, *The fix lands at the
    // mechanism*: detection a sibling surface already performs is shared,
    // never re-derived).
    //
    // First git's registry: a directory git disclaims is as easily an
    // operator's own tree, or residue whose registration git has already
    // pruned.
    const registry = await readWorktreeRegistry(ctx.repoRoot);
    if (!registry.read) {
      throw new Error(
        `worktree path is occupied and the git worktree registry could not be read (${registry.reason}); refusing to remove a directory git may not own: ${path}`,
      );
    }
    if (!registry.worktrees.has(resolve(path))) {
      throw new Error(
        `worktree path is occupied by a directory git does not register as a worktree of ${ctx.repoRoot}; refusing to remove it — clear it by hand if it is flume residue: ${path}`,
      );
    }
    // Then this root's own stamp. The registry names every worktree of the
    // *repository*, which is wider than "this state root made it": under a
    // base an operator deliberately shares between checkouts
    // (`spec/worktrees.md`, *Placement — the worktree base*), a sibling's
    // live tree registers exactly here, and a colliding `dirName` would take
    // it out from under a running sibling on the registry's word alone.
    const ownStateRoot = resolve(ctx.flumeDir);
    const stamped = await stampedStateRoot(path);
    if (stamped !== ownStateRoot) {
      throw new Error(
        `worktree path is occupied by a registered worktree this state root (${ownStateRoot}) did not provision ` +
          `(${stamped === undefined ? "no stamp" : `stamped ${stamped}`}); refusing to remove it — ` +
          `a second checkout sharing this worktree base is the likely occupant: ${path}`,
      );
    }
    await git.removeWorktree(ctx.repoRoot, path, ctx.log);
  }
  await mkdir(toNamespacedPath(dirname(path)), { recursive: true });
  // Fanout worktrees nest at least as deep as the state root they're cloned
  // for — the identical win32 MAX_PATH gap the state root's own reads
  // (`src/pidClaim.ts`, `src/friction.ts`) are pinned against.
  await git.pinLongPaths(ctx.repoRoot);
  await git.addWorktree({
    repoRoot: ctx.repoRoot,
    path,
    branch,
    fromRef,
    log: ctx.log,
  });
  // The evidence the next start's sweep — and the occupied-path judgment
  // above, on the next tick that computes this same path — removes on.
  // Written after the add, which is the first moment git has an admin
  // directory to hold it, and before the caller is told the worktree exists:
  // a tree this call handed back unstamped is one both would decline
  // forever.
  await stampWorktree(path, ctx.flumeDir);
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
    await git.removeWorktree(ctx.repoRoot, wt.path, ctx.log);
    removed = true;
  } catch {
    // Caller records the surviving path.
  }
  try {
    await git.deleteBranch(ctx.repoRoot, wt.branch);
  } catch (err) {
    ctx.log.warn(
      `[flume] deleting branch ${wt.branch} failed: ${(err as Error).message}`,
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
 * `flume loop` calls this once through
 * `Dispatcher.sweepStaleWorktrees`, after the tip claim is
 * acquired and before the first tick (`src/cli.ts`) — holding the claim
 * is the guard, and it reaches exactly this state root: one flume writer
 * per ref means no live sibling of *this* root owns anything it
 * provisioned. It says nothing about a second checkout of the same
 * repository, whose tip differs and whose claim is therefore grantable
 * beside this one. A bare `flume tick`
 * never calls this; its per-wave prune and stale-slug removal are
 * unchanged.
 *
 * Scope is exactly the engine's own residue: every directory directly
 * under the worktree base — the same `worktreesBase` (`src/paths.ts`)
 * `createWorktree` provisions into, with no level minted beneath it
 * (`spec/worktrees.md`, *Placement — the worktree base*). That base is
 * asked to be flume-exclusive, but what sits at that level is still not
 * the sweep's to guess: an operator's own tree, a directory whose worktree
 * registration git has already pruned, and this run's abandoned residue
 * are indistinguishable by name. So a bare `readdir` + blind removal would
 * delete whatever happened to be there. Two facts disambiguate, and neither
 * is a naming heuristic (`.claude/rules/engine-boundary.md`, *Told, not
 * inferred*).
 *
 * The first is git's own registry: {@link readWorktreeRegistry} — the same
 * probe {@link createWorktree} clears an occupied path on — names every path
 * git currently considers a worktree of this repo, and anything git disclaims
 * is left untouched.
 *
 * The second is the sweep's own evidence, minted at provisioning rather than
 * inferred from that registry: the registry names every worktree of the
 * *repository*, which is a wider claim than "this state root made it". A
 * second checkout of one repository holds a different tip, so its tip claim
 * is grantable beside this one, and under a shared `FLUME_WORKTREES_DIR`
 * (*Placement*) its live trees sit at exactly the level read here. So a
 * registered directory is removed only where {@link stampWorktree}'s stamp
 * names this state root; one carrying no stamp — a sibling's tree, or residue
 * from a run that predates the stamp — is left where it is and named once,
 * never removed on a registry entry alone.
 *
 * What survives both tests goes through `git.removeWorktree` +
 * win32-fallback (the same path teardown uses). Then a final `git
 * worktree prune`; then the branches those removed directories were checked
 * out on.
 *
 * **The branch leg is bound by the same registry the directory leg reads**,
 * never by the `flume/…` name alone. Two checkouts of one repository hold
 * different tips, so both are grantable a tip claim and both sweeps run
 * against one shared ref namespace: a reap keyed on the name would delete a
 * sibling checkout's live branch this sweep never provisioned, its worktree
 * sitting under a base this sweep cannot even see. The pairing is git's own —
 * {@link readWorktreeRegistry} reports the branch beside the path — so the
 * leg reaps exactly what it just removed, and a directory that survived
 * removal keeps its branch (the ref is still checked out there, and deleting
 * it is not this sweep's call). What that costs is a branch whose directory
 * git had already pruned the registration for: nothing pairs it, so it stays
 * for an operator, the same trade the directory leg takes above.
 *
 * Never throws: an unreadable or absent base, an unreadable registry, an
 * unreadable stamp, a surviving worktree directory (locked handle, EBUSY), a
 * prune failure, or a branch that won't delete are each logged and swallowed
 * rather than propagated — a sweep that could abort the run would convert
 * dead residue into a denial of service on the live queue. Silent on an
 * absent or empty base, the normal case; a surviving worktree path and a
 * registered directory left standing for want of this root's stamp are each
 * warned once for the whole run, not once per directory. A registry the probe
 * could not read removes nothing and says so: an unreadable registry is not a
 * base with nothing registered in it, and the two must not print the same
 * silence.
 */
export async function sweepStaleWorktrees(
  ctx: WorktreeContext,
): Promise<void> {
  const repoRoot = ctx.repoRoot;
  const sweepBase = worktreesBase(ctx.flumeDir, ctx.declaredWorktreesBase);

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

  // Which top-level entries are actually this run's own worktrees, as
  // opposed to an operator's own tree or residue whose registration git has
  // already pruned: git's own registry, not the entry's name.
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
  // Registered directories this state root did not stamp: a second checkout's
  // live worktree under a shared base, or residue from a run that predates
  // the stamp. Left standing, and named once at the end — the registry says
  // git owns them, and nothing says this root provisioned them.
  const unstamped: string[] = [];
  // The state root whose worktrees this sweep owns, in the spelling
  // `stampWorktree` wrote.
  const ownStateRoot = resolve(ctx.flumeDir);
  // The branches the removed directories were checked out on — collected as
  // each removal succeeds, so the leg below reaps what this sweep just took
  // down and nothing else. A detached tree (a gate's `checkoutAt` residue)
  // pairs with no branch and contributes none.
  const reapable: string[] = [];
  if (registry.read) {
    for (const name of entries) {
      const path = join(sweepBase, name);
      const resolved = resolve(path);
      if (!registry.worktrees.has(resolved)) {
        // Not a worktree git knows about — an operator's own tree, or
        // residue whose registration was already pruned. Not this run's to
        // remove; leave it untouched.
        continue;
      }
      if ((await stampedStateRoot(path)) !== ownStateRoot) {
        // Registered, but not on this root's evidence. The tip claim this
        // sweep holds guards this state root's worktrees alone: a second
        // checkout of the same repository has a different tip, so its claim
        // is grantable too, and under a shared base its live trees sit at
        // exactly this level. Removing one on the registry's word would take
        // a running sibling's worktree out from under it.
        unstamped.push(path);
        continue;
      }
      const branch = registry.worktrees.get(resolved);
      try {
        await git.removeWorktree(repoRoot, path, ctx.log);
        if (branch !== undefined) reapable.push(branch);
      } catch {
        // The directory stands, and the branch is still checked out in it:
        // neither is this sweep's to reclaim now.
        survivingPaths.push(path);
      }
    }
  }
  try {
    await git.pruneWorktrees(repoRoot, ctx.log);
  } catch (err) {
    ctx.log.warn(
      `[flume] startup sweep: worktree prune failed: ${(err as Error).message}`,
    );
  }

  // Run after the prune, not before: `git branch -D` refuses a branch git
  // still has registered against a worktree, and `--force` removal leaves
  // that registration behind for the prune above to clear.
  for (const branch of reapable) {
    try {
      await git.deleteBranch(repoRoot, branch);
    } catch (err) {
      ctx.log.warn(
        `[flume] startup sweep: deleting branch ${branch} failed: ${(err as Error).message}`,
      );
    }
  }

  if (unstamped.length > 0) {
    ctx.log.warn(
      `[flume] startup sweep: ${unstamped.length} registered worktree(s) under ${sweepBase} carry no stamp from this state root (${ownStateRoot}) and were left standing: ${unstamped.join(", ")}`,
    );
  }

  if (survivingPaths.length > 0) {
    ctx.log.warn(
      `[flume] startup sweep: ${survivingPaths.length} worktree(s) survived removal (fallback exhausted): ${survivingPaths.join(", ")}`,
    );
  }
}
