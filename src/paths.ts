/**
 * paths — shared path machinery: the win32 total-path-limit fix idiom, the
 * glob matcher, the filesystem-safe tag slug, the length bound every
 * composed path component passes through, the dot-prefixed-name test, the
 * fold into git's alphabet with the escape verdict and state-root offset
 * built on it, and the layout a repo root, a flume state root, and a config
 * dir each carry.
 *
 * For the MAX_PATH idiom see `.claude/rules/platform-facts.md`, "Windows
 * MAX_PATH (~260 chars) breaks fs calls with no long component"; every call
 * site that builds a path for an fs call wants both steps together, and this
 * is the one place that pairs them.
 *
 * Those layout sections (bottom of this file) are here for the same reason
 * and need nothing beyond `node:path`, so the CLI, the dispatcher and the
 * baton can all reach them without a cycle. The module's
 * only other imports keep that property: `Phase` is type-only and erased,
 * and `PendingSchema` reaches no further than zod.
 */

import { createHash } from "node:crypto";
import {
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
  toNamespacedPath,
} from "node:path";

import type { Phase } from "./Phase.js";
import { declaredPaths, type PendingEntry } from "./PendingSchema.js";

/** `join(...paths)`, then `toNamespacedPath` — the win32 MAX_PATH fix idiom. */
export function namespacedJoin(...paths: string[]): string {
  return toNamespacedPath(join(...paths));
}

/**
 * The idiom's inverse: one path out of win32's namespaced alphabet and into
 * its plain one. This is where a fold is *spent* when the answer it rode out
 * on is compared rather than handed back to an fs call — the CLI's entry
 * check (`onDiskIdentity`, `src/cli.ts`) is the comparison that spends it.
 *
 * Why an fs answer needs folding at all, and why the fold is unconditional
 * rather than gated on the platform: `.claude/rules/platform-facts.md`,
 * "realpathSync keeps the \\?\ prefix only where nothing resolved".
 *
 * The UNC arm restores the `\\` root `toNamespacedPath` replaced with
 * `\\?\UNC\`, so the two directions compose back to where they started.
 */
export function plainPath(path: string): string {
  if (path.startsWith("\\\\?\\UNC\\")) return `\\\\${path.slice("\\\\?\\UNC\\".length)}`;
  if (path.startsWith("\\\\?\\")) return path.slice("\\\\?\\".length);
  return path;
}

/**
 * A path the host composed, as the forward-slash form git speaks.
 *
 * git names every path with `/` on every platform, so a value that has been
 * through `join` or `relative` on win32 is in the wrong alphabet the moment
 * it is compared against a commit's touched path, handed to git as a
 * pathspec, matched by a fence glob, or written into `.gitignore`. This is
 * the rule that converts one — the engine's own, exported because a chain
 * composing a committed path from a root the engine reported would otherwise
 * spell it again (`.claude/rules/engineering.md`, *A fact the engine holds is
 * reported, never rediscovered*).
 *
 * Both separators fold, not just the host's: a value routinely carries `/`
 * from a declaration and `\` from `relative` in the same string, and a rule
 * keyed on `sep` would leave that case half-converted. The cost is that a
 * posix filename containing a literal backslash is split like a separator —
 * accepted, because every path this rule is applied to is one git will name,
 * and git's own quoting makes such a name unaddressable here anyway.
 */
export function gitPath(path: string): string {
  return path.split(/[\\/]/).join("/");
}

/**
 * Whether `path` lands outside `root` — the one spelling of "escapes", asked
 * of two already-resolved absolute paths.
 *
 * `relative` answers with a `..` lead when the target climbs out of the root
 * and with an absolute path when the two share no root at all (a different
 * win32 drive), and those two shapes are the whole verdict. Here rather than
 * at each asker because every site that asks it reads one rule — the
 * declared-field check below, the state root's own escape verdict
 * ({@link computeStateRootRel}), the ledger's relocation check
 * (`isPendingRelocated`, `src/pendingLedger.ts`), the base run's selection
 * (`baseTree`, `harness/toolRun.ts`) and the file a validator names on a
 * verdict line (`readLine`, `harness/scriptRunner.ts`) — and a further
 * spelling is how two of them come to disagree about what leaving a root
 * means (`.claude/rules/engineering.md`, *The fix lands at the mechanism*).
 * A prefix test over the relative path is the spelling that drifts first: it
 * reads an interior climb (`a/../../b`) as inside.
 */
export function escapesRoot(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel);
}

/**
 * The state root's path relative to the primary repo root **in git's own
 * alphabet** ({@link gitPath}), or `undefined` when the state root is
 * relocated outside it (climbs out via `..`, or is already absolute — a
 * relocated `flumeDir` set by an absolute `FLUME_DIR`).
 *
 * The fold lands here, at the one reporter, because every consumer of this
 * value composes a path git will name — a pathspec at a sha, a fence glob, a
 * commit's touched path. `relative` answers in the host's dialect, so
 * reporting it raw makes the conversion each reader's problem and puts a
 * sibling path in the other alphabet the first time one reader forgets. Path
 * arithmetic and nothing else, which is why it sits with the engine's other
 * path rules rather than inside the orchestrator that happens to call it
 * first (`.claude/rules/engineering.md`, *A module is one job*).
 *
 * The dispatcher (`src/Dispatcher.ts`) computes it once, from the two roots
 * that never change after its construction, and shares it on every
 * `GateContext.stateRootRel` and with `harvestFriction`'s own worktree-mirror
 * check (`src/friction.ts`; spec/chain.md "What a gate receives"). One
 * further consumer calls it with a different second root, a path whose escape
 * status decides whether a worktree holds a mirror of it: the `afterCommit`
 * gate-context build passes `configDir`, rebasing it onto the worktree only
 * when it resolves inside the repo. The ledger's own relocation check
 * (`isPendingRelocated`, `src/pendingLedger.ts`) asks the escape half of the
 * same question about `pendingPath` — a descendant of the state root
 * ({@link resolvePendingPath}) whose escape status against `repoRoot` always
 * matches `flumeDir`'s own — and reaches it through the {@link escapesRoot}
 * this function reads it from. Neither re-derives the check
 * (`.claude/rules/engineering.md` "The fix lands at the mechanism").
 */
export function computeStateRootRel(
  repoRoot: string,
  flumeDir: string,
): string | undefined {
  if (escapesRoot(repoRoot, flumeDir)) return undefined;
  return gitPath(relative(repoRoot, flumeDir));
}

/**
 * Shared escape-check for a declared state-root-relative path
 * (`Chain.friction` — `validateFrictionDeclaration`, `src/friction.ts`;
 * `Chain.pendingPath` — `validatePendingPathDeclaration`,
 * `src/chainLoad.ts`): must be relative, and must still resolve inside the
 * root it is joined to.
 *
 * Base-independent: it resolves the declared path against an arbitrary
 * sentinel root and asks whether the result still sits under that root, so
 * it needs no actual `flumeDir` value. That value legitimately varies per
 * call site (a relocated state root differs from `configDir`, where
 * `chain.ts` itself lives), but "does this relative path escape whatever
 * root it's joined to" is a property of the path string alone.
 *
 * Here rather than beside either caller because both reach it, and because
 * the check is path shape and nothing else — one spelling, so two declared
 * fields cannot disagree about what escaping the state root means
 * (`.claude/rules/engineering.md`, "The fix lands at the mechanism").
 */
export function assertStateRootRelative(
  fieldName: string,
  value: string,
  shapeHint: string,
): void {
  if (isAbsolute(value)) {
    throw new Error(
      `chain declares ${fieldName} '${value}' as an absolute path; ` +
        `Chain.${fieldName} must be a state-root-relative ${shapeHint}`,
    );
  }
  const sentinelRoot = resolve("__flume_state_root__");
  if (escapesRoot(sentinelRoot, resolve(sentinelRoot, value))) {
    throw new Error(
      `chain declares ${fieldName} '${value}' which resolves outside the state root; ` +
        `Chain.${fieldName} must be a state-root-relative ${shapeHint}`,
    );
  }
}

/**
 * Minimal glob matcher supporting `*`, `**`, and literal paths. We avoid a
 * dependency here so the harness has zero runtime deps beyond zod. Shared
 * home for every consumer that judges a real commit path against a declared
 * (possibly glob) path list — the write guard and ship detection both need
 * this, and a caller-local copy is how the two drift apart.
 */
export function matchesAny(path: string, globs: string[]): boolean {
  return globs.some((g) => globToRegex(g).test(path));
}

function globToRegex(glob: string): RegExp {
  // One pass, longest wildcard first: each source character is read once and
  // written straight to its compiled form. Nothing the compiler emits is read
  // back, so no text a declared path may legitimately carry can be mistaken
  // for a compiler marker. An earlier spelling staged `**` through a
  // `::DOUBLESTAR::` literal and re-scanned for it, so a declared path
  // containing that text compiled to `.*` and admitted every path
  // (`.claude/rules/engineering.md`, "The fix lands at the mechanism").
  //
  // `?` is escaped, not implemented: `*` and `**` are the only wildcards this
  // matcher has (spec/pending.md, "The entry-scoped write guard is opt-in,
  // and off by default"), so `?` is a regex special like any other and a
  // declared path carrying one matches only itself. Left unescaped it made
  // its preceding character optional, so the fence both refused its own
  // declared path and admitted an undeclared neighbor.
  const re = glob.replace(/\*\*|\*|[^*]+/g, (token) => {
    if (token === "**") return ".*";
    if (token === "*") return "[^/]*";
    return token.replace(/[.+^${}()|[\]\\?]/g, "\\$&"); // escape regex specials
  });
  return new RegExp(`^${re}$`);
}

/**
 * `writablePaths ∪ entryChannelPaths`, deduped — the one spelling of the
 * union every fence in this engine is made of. Both derivations below take
 * it from here: {@link entryWriteScope} for the allowance one scoped tick
 * runs under, {@link queueFenceViolations} for the fence a whole queue is
 * pre-checked against (.claude/rules/engineering.md "Derived state is
 * computed, never restated beside its source").
 */
export function entryWriteScopeUnion(
  entryPaths: string[],
  channelPaths: string[],
): string[] {
  return [...new Set([...entryPaths, ...channelPaths])];
}

/**
 * The write scope a tick actually runs under: `undefined` when the tick is
 * unscoped — no entry assigned, or a phase that never declared
 * `scopeWritesToEntry` (spec/pending.md "The entry-scoped write guard is
 * opt-in, and off by default") — and the entry's declared files ∪ the
 * phase's channel globs when it is scoped.
 *
 * **The one site that decides scoped-or-not, and the one site that names the
 * two inputs.** Both consumers of the decision take it from here:
 * `effectiveFenceLines` (`src/Prompt.ts`) renders the scope for the agent,
 * and `src/tickAttempt.ts` hands the same value to `writablePathsGate`
 * (`src/builtinGates.ts`), which enforces it against the commit. Each used
 * to spell the `assignedEntry && phase.scopeWritesToEntry` test and the
 * `declaredPaths(entry)` / `phase.entryChannelPaths ?? []` pair for itself,
 * sharing only the final union — so a one-sided edit could render a fence
 * the guard did not enforce (`.claude/rules/engineering.md`, "The fix lands
 * at the mechanism").
 *
 * `observedFiles` is deliberately not in scope: `declaredPaths` is the
 * entry's *declaration*, and observed files feed the fanout partition, not
 * the write allowance.
 */
export function entryWriteScope(
  phase: Pick<Phase, "scopeWritesToEntry" | "entryChannelPaths">,
  assignedEntry: PendingEntry | undefined,
): string[] | undefined {
  if (!assignedEntry || !phase.scopeWritesToEntry) return undefined;
  return entryWriteScopeUnion(
    declaredPaths(assignedEntry),
    phase.entryChannelPaths ?? [],
  );
}

/** One queue entry's declared paths that the consumer fence would not admit. */
interface QueueFenceViolation {
  /** The offending entry's `tag`, as the queue spells it. */
  tag: string;
  /** Its declared paths that match no glob in the fence, declaration order. */
  offending: string[];
}

/**
 * The consumer-phase fence pre-check: which queue entries declare files the
 * phase that will build them could never write. Empty means every entry's
 * declaration survives the fence.
 *
 * **The one derivation.** Both surfaces that pre-check a queue read the
 * fence and the per-entry violation list from here — `pendingGate`
 * (`src/builtinGates.ts`) refusing a plan commit that queues unshippable
 * work, and `flume check` (`src/cli.ts`) answering the same question for an
 * operator off the tick path. Each used to spell the `writablePaths ∪
 * entryChannelPaths` union and the `declaredPaths(e).filter(...)` scan for
 * itself, so a one-sided edit could make the gate and the verb name
 * different offending paths for one queue (`.claude/rules/engineering.md`,
 * "The fix lands at the mechanism").
 *
 * `consumers` is a list because a chain may declare more than one phase that
 * picks from `pending`: an entry has to survive only the union, since any one
 * of them could pick it. Callers select the consumers (`pendingGate` is told
 * its one `targetFence`; `flume check` reads every fanout phase) and callers
 * choose which entries to submit (`pendingGate.fenceWhen` exempts park-kinds
 * before this point) — this derivation decides neither.
 *
 * Reads `declaredPaths`, never `touchedPaths`: `observedFiles` is what a
 * tick reported touching, not what the entry declares, and the fence binds
 * on the declaration.
 */
export function queueFenceViolations(
  entries: readonly PendingEntry[],
  consumers: readonly Pick<Phase, "writablePaths" | "entryChannelPaths">[],
): QueueFenceViolation[] {
  const fence = entryWriteScopeUnion(
    consumers.flatMap((p) => p.writablePaths),
    consumers.flatMap((p) => p.entryChannelPaths ?? []),
  );
  return entries
    .map((entry) => ({
      tag: entry.tag,
      offending: declaredPaths(entry).filter((p) => !matchesAny(p, fence)),
    }))
    .filter((v) => v.offending.length > 0);
}

/**
 * Filesystem-safe slug for a pending tag — shared by worktree + prior-attempt
 * keying. Never lengthens the input (runs of disallowed chars collapse to a
 * single `-`), so anything bounding raw `tag` length also bounds this.
 *
 * Here rather than beside either consumer because both reach it: the
 * dispatcher's worktree dir/branch naming and `src/priorAttempts.ts`'s record
 * keying, plus the chain-facing copy handed out on `FlumeApi`. One spelling,
 * so a worktree and the record keyed for the same entry cannot disagree.
 *
 * `tag` itself is length-bounded at the schema gate (`PendingSchema.ts`
 * `TAG_MAX_LENGTH`), derived from the tick's tightest raw-tag consumer —
 * `writeRevertNote` (`src/tickAttempt.ts`) and its
 * `` `${stamp}--${entry.tag}--reverted.md` `` — so the branch name and the
 * prior-attempt key, which are this slug and nothing else, are bounded by
 * construction. A component that composes the slug (or the raw tag) with a
 * second variable-length part is not, and takes {@link boundedName}.
 * Agreement between the two sides is pinned by tests/Dispatcher.test.ts,
 * "revert note to the friction channel", not asserted here.
 */
export function slugify(tag: string): string {
  return tag.toLowerCase().replace(/[^a-z0-9-]+/g, "-");
}

/**
 * The one truncation any composed path component passes through: `name`
 * unchanged when it already fits `max`, else cut to leave room for a
 * separator plus a 10-hex-character SHA-1, so the finished component is
 * exactly `max` characters and two inputs sharing a long common prefix still
 * land on distinct names. The bound is on the *finished* name, never on a
 * part before the suffix.
 *
 * `identity` is what the hash keys — the full value whose distinctness the
 * caller is preserving, which need not be the string being cut: the worktree
 * directory bounds `slugify(tag)` but keys off the raw `tag`, since
 * `slugify` is lossy and two tags differing only in case would otherwise
 * hash alike. Defaults to `name`, the case where nothing was lost upstream.
 *
 * Shared rather than spelled beside each caller
 * (`.claude/rules/engineering.md`, "The fix lands at the mechanism"):
 * `createWorktree`'s directory name bounds against git's win32 worktree-path
 * wall, and `harvestFriction`'s destination filename against filesystem
 * NAME_MAX. Two ceilings, one rule — and a second spelling is how one of them
 * comes to truncate without a hash and start silently overwriting.
 */
export function boundedName(
  name: string,
  max: number,
  identity: string = name,
): string {
  if (name.length <= max) return name;
  const hash = createHash("sha1").update(identity).digest("hex").slice(0, 10);
  return `${name.slice(0, max - hash.length - 1)}-${hash}`;
}

/**
 * Whether a filename is dot-prefixed — the one spelling of "a placeholder
 * git made the consumer create is no work". Every friction-channel surface
 * that decides whether a name is a note shares it (spec/chain.md,
 * "`Chain.friction` — the declared friction channel"), and there are two:
 * `frictionNotes` (`src/friction.ts`), the channel's one listing, behind the
 * status count, the `friction` verb's bare list, the teardown harvest's
 * candidates — which would otherwise relay a skipped name into the primary
 * dir under a stamped one the readers can no longer skip — and the harness
 * package's window; and the `friction` verb's read-by-name (`src/cli.ts`),
 * which resolves a name the operator typed rather than one it listed. One
 * detection, never re-derived beside each
 * (`.claude/rules/engineering.md`, "The fix lands at the mechanism") — a
 * second spelling is how the count and the listing come to disagree about
 * what the channel holds.
 *
 * The test is on the name alone, never on content: the caller passes the
 * name a directory entry carries on disk, so a reader given `"./.gitkeep"`
 * resolves it to its basename first rather than asking this.
 */
export function isDotName(name: string): boolean {
  return name.startsWith(".");
}

// ---------- the repo root's layout ----------

/**
 * The bay's own name under a repository root — the directory the walk-up
 * discovery probe looks for (`resolveRepoRoot`, `src/cliStateDirs.ts`)
 * and the one every state root defaults into absent `FLUME_DIR`
 * (spec/cli.md, *State-root and config-dir resolution*).
 *
 * Exported for the one consumer that needs the bare name rather than a
 * path: the harness package's `DEFAULT_STATE_ROOT` (`harness/init.ts`),
 * which writes it into a consumer's declaration, ignore set and protocol
 * page. Everything that builds a path takes an accessor below.
 */
export const STATE_ROOT_DIRNAME = ".flume";


/**
 * The state root a repo root carries when nothing relocates it —
 * `<repoRoot>/.flume`.
 *
 * **The one composition.** Every default that resolves to the bay reads it
 * here: `resolveStateDirs`'s two dirs (`src/cliStateDirs.ts`), the
 * `Dispatcher`'s `flumeDir` (`src/Dispatcher.ts`) and `superviseLoop`'s two
 * (`src/loopSupervisor.ts`). Each used to spell the layout itself, so a relocation had
 * to be remembered at a dozen sites, and a site that forgot would resolve a
 * state root the rest of the engine never reads
 * (`.claude/rules/engineering.md`, *Derived state is computed, never
 * restated beside its source*).
 */
export function defaultStateRoot(repoRoot: string): string {
  return join(repoRoot, STATE_ROOT_DIRNAME);
}

// ---------- the state root's layout ----------

/**
 * The names the runtime itself owns directly under a flume state root
 * (`flumeDir`) — the baton dir, the prior-attempt records, the merge-stage
 * markers, the one-supervisor lock, the stop flag, the tick verdicts. Writer and reader of each of these sit in different
 * modules (`flume stop` refuses, the supervisor honors; `flume loop` claims
 * the lock, `liveLoopPid` reads it back), so a copy of the name in each is a
 * rename away from a silent bypass — this is the one place any of them is
 * spelled (`.claude/rules/engineering.md`, "Derived state is computed, never
 * restated beside its source").
 *
 * Exported for the one consumer that needs a bare name rather than a path:
 * the runtime ignore set (`RUNTIME_IGNORES`, `src/runtimeIgnores.ts`).
 * Everything
 * that builds a path takes an accessor below.
 *
 */
export const STATE_ROOT_NAMES = {
  awake: "awake",
  priorAttempts: "prior-attempts",
  renderedPrompts: "rendered-prompts",
  worktrees: "worktrees",
  merging: "merging",
  loopLock: "loop.pid",
  stopFlag: "stop",
  tickVerdict: "tick-verdict.json",
  tickVerdictsLog: "tick-verdicts.jsonl",
} as const;

/**
 * The instant, in the filesystem-safe form every timestamp-prefixed runtime
 * filename uses (`:` and `.` are not portable in a path component). One
 * writer for the format, so a session capture, a revert note, a friction
 * harvest, and a rendered-prompt record all sort and parse alike.
 */
export function fsStamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

/** The baton's awake-flag dir — `<flumeDir>/awake` (`src/Baton.ts`). */
export function awakeDir(flumeDir: string): string {
  return join(flumeDir, STATE_ROOT_NAMES.awake);
}

/**
 * Where prior-attempt records and their reverted-file snapshots live —
 * gitignored harness runtime state beside the baton, NOT in a per-entry
 * worktree (a fanout retry gets a fresh worktree; the record must outlive
 * it). Re-exported from `src/priorAttempts.ts`, which owns the records
 * themselves, so a chain's `shouldRun` can scan the dir the dispatcher
 * writes without hardcoding its name.
 */
export function priorAttemptsDir(flumeDir: string): string {
  return join(flumeDir, STATE_ROOT_NAMES.priorAttempts);
}

/**
 * Where each invocation's fully rendered prompt is persisted before the
 * agent runs (spec/prompt.md "The rendered prompt is persisted before the
 * agent runs") — the read-side record beside the prior-attempt dir, named on
 * the tick verdict's invocation row as a path relative to `flumeDir`.
 */
export function renderedPromptsDir(flumeDir: string): string {
  return join(flumeDir, STATE_ROOT_NAMES.renderedPrompts);
}

/**
 * The worktree base, every tick's alike, in resolution order:
 * `FLUME_WORKTREES_DIR` when set (resolved absolute), else the chain's
 * declared base when it declared one, else `<flumeDir>/worktrees`
 * (spec/worktrees.md, "Placement — the worktree base").
 *
 * **The one resolution in `src/`.** `createWorktree`, the per-wave
 * stale-slug removal it runs, `sweepStaleWorktrees` and `checkoutAt` all
 * take the base from here. Two resolutions agreed only by luck: a sweep
 * basing on the default while creation honored the override found nothing to
 * remove, then failed every `git branch -D` against worktrees still standing
 * at the real base (field-traced four times).
 *
 * The override exists for one measured vector: an agent whose `pwd` contains
 * the root checkout's path as a prefix can derive the root and write there
 * (observed: a model that sees `<root>/.flume/worktrees/x` operates in
 * `<root>`). Pointing the base outside every repo-path prefix removes the
 * prefix, and with it the inference. The default tracks the state root,
 * itself relocatable via `FLUME_DIR`, so the one-`rm` teardown promise holds.
 *
 * `declared` is `Chain.worktreesBase` already **evaluated** — a chain
 * declares how to compute a base, not a path, and the engine runs that
 * computation once per chain load (`resolveWorktreesBaseDeclaration`,
 * `src/chainLoad.ts`) and carries the
 * string from there. An operator's env var still outranks it: the chain is
 * committed, the host is not. Empty is no declaration, the same reading an
 * empty override gets — `resolve("")` is cwd, which would scatter worktrees
 * across the checkout.
 *
 * Read at call time, not at module load: the CLI resolves `FLUME_DIR` and a
 * chain may export `FLUME_WORKTREES_DIR` during its own load, both after
 * this module is first evaluated.
 */
export function worktreesBase(flumeDir: string, declared?: string): string {
  const override = process.env.FLUME_WORKTREES_DIR;
  if (override) return resolve(override);
  if (declared) return declared;
  return join(flumeDir, STATE_ROOT_NAMES.worktrees);
}

/**
 * spec/loop.md "Crash equals stop": where the merge stage leaves one marker
 * per entry whose span it is mid-way through putting on trunk —
 * `<flumeDir>/merging/<slug>.json`. Written before the pick and removed once
 * the ship bookkeeping has landed, so a file here at the next `loop` start
 * is a merge a crash interrupted and the run refuses.
 *
 * Same split as {@link tickVerdictPath}: this module owns the name so the
 * CLI's startup refusal can reach it without importing the marker's reader,
 * and `src/mergingMarkers.ts` owns what the file carries and when.
 */
export function mergingDir(flumeDir: string): string {
  return join(flumeDir, STATE_ROOT_NAMES.merging);
}

/**
 * One entry's marker under {@link mergingDir}, keyed by its `slugify`d tag —
 * the same slug the entry's worktree and prior-attempt record use, so an
 * operator reconciling a survivor reads one identity across all three.
 */
export function mergingMarkerPath(flumeDir: string, slug: string): string {
  return join(mergingDir(flumeDir), `${slug}.json`);
}

/**
 * The cross-process loop lock — one supervisor per state root. `flume loop`
 * writes its pid here; `liveLoopPid` (`src/pidClaim.ts`) and `flume status` read
 * it back.
 */
export function loopLockPath(flumeDir: string): string {
  return join(flumeDir, STATE_ROOT_NAMES.loopLock);
}

/**
 * The graceful-stop flag (spec/loop.md "Graceful stop — the stop flag"):
 * `flume stop` writes it, `flume loop` refuses to start over it, and the
 * supervisor's per-iteration check ends a live run on it.
 */
export function stopFlagPath(flumeDir: string): string {
  return join(flumeDir, STATE_ROOT_NAMES.stopFlag);
}

/**
 * The latest tick's verdict alone, overwritten every real `flume tick` and
 * removed by `clearTickVerdict` before that tick's own work begins.
 * Re-exported from `src/tickVerdict.ts`, which owns what the file carries and
 * when — this module owns only the name, so the runtime ignore set can
 * reach it without importing the verdict's I/O.
 */
export function tickVerdictPath(flumeDir: string): string {
  return join(flumeDir, STATE_ROOT_NAMES.tickVerdict);
}

/**
 * The append-only verdict history `readTickVerdicts` (`src/tickVerdict.ts`)
 * reads back for a chain's recent-tick rendering. Same split as
 * {@link tickVerdictPath}: the name here, the semantics there.
 */
export function tickVerdictsLogPath(flumeDir: string): string {
  return join(flumeDir, STATE_ROOT_NAMES.tickVerdictsLog);
}

/**
 * The pending queue's path when `Chain.pendingPath` is undeclared, relative
 * to the state root (spec/pending.md "The pending queue"). Callers that
 * resolve against a state root want {@link resolvePendingPath}; this is for
 * the ones that report the relative form to an operator.
 */
export const DEFAULT_PENDING_REL = join("plan", "pending.json");

/**
 * The queue file a state root actually reads: the chain's declared
 * `pendingPath` when it has one, {@link DEFAULT_PENDING_REL} otherwise,
 * resolved against `stateRoot`. Every consumer of the queue — the
 * dispatcher, `flume check`, `flume status` — resolves it here, so an
 * undeclared queue is the same absolute file on all of them.
 */
export function resolvePendingPath(stateRoot: string, declared?: string): string {
  return join(stateRoot, declared ?? DEFAULT_PENDING_REL);
}

// ---------- the config dir's layout ----------

/**
 * The chain module's filename under a config dir. Spelled here and nowhere
 * else in `src/`: the loader that imports it and the gate that decides
 * whether a commit touched it both read {@link chainModulePath}, so the two
 * cannot disagree about which file the chain is.
 */
export const CHAIN_MODULE_NAME = "chain.ts";

/**
 * The chain a config dir carries — `<configDir>/chain.ts`, absolute
 * (spec/chain.md "Chain residency").
 *
 * **The one derivation.** `loadChainModule` (`src/chainLoad.ts`) resolves
 * the file it imports from here, and `chainLoadGate` (`src/builtinGates.ts`)
 * keys its touched-path check on this path made repo-relative. Each used to
 * spell the filename itself, and the gate's copy was the silent one: a
 * divergence leaves it reporting
 * `skipped` over the very commit that broke the chain the loader then
 * refuses (`.claude/rules/engineering.md`, "The fix lands at the
 * mechanism").
 *
 * Absolute, `resolve`d rather than `join`ed, because a relative `configDir`
 * reaches fs calls and `pathToFileURL` from here. Callers wanting the win32
 * MAX_PATH form wrap the result in `namespacedJoin`; callers wanting a
 * repo-relative key take `relative(repoRoot, …)` of it.
 */
export function chainModulePath(configDir: string): string {
  return resolve(configDir, CHAIN_MODULE_NAME);
}

/**
 * The file a phase's `promptPath` names, absolute (spec/chain.md "Chain
 * residency"). Resolved, never joined: a relative `promptPath` keeps its
 * meaning beneath the config dir, and an absolute one is taken as given —
 * which is how a prompt shipped inside a package gets an address rather than
 * a path the chain is assumed to hold beneath itself.
 *
 * Both dispatcher render sites — singleton and fanout — read the prompt from
 * here, so neither can address a phase's prompt differently from the other.
 */
export function phasePromptPath(configDir: string, promptPath: string): string {
  return resolve(configDir, promptPath);
}
