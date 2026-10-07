/**
 * paths — shared path machinery: the win32 total-path-limit fix idiom, the
 * glob matcher with the foreign-dialect forms a fence may not carry, the
 * filesystem-safe tag slug, the length bound every
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
 * on is compared rather than handed back to an fs call — `onDiskIdentity`
 * (`src/pathIdentity.ts`) is where every such comparison spends it.
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
 * at each asker because every site that asks it reads one rule, and a further
 * spelling is how two of them come to disagree about what leaving a root
 * means (`.claude/rules/engineering.md`, *The fix lands at the mechanism*).
 * Each asker says at its own site why it asks; which sites those are is the
 * program's answer, not a list kept here by hand
 * (`.claude/rules/engineering.md`, *Derived state is computed, never restated
 * beside its source*).
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
 */
export function computeStateRootRel(
  repoRoot: string,
  innerRoot: string,
): string | undefined {
  if (escapesRoot(repoRoot, innerRoot)) return undefined;
  return gitPath(relative(repoRoot, innerRoot));
}

/**
 * Shared escape-check for a declared state-root-relative path
 * (`Chain.friction` — `validateFrictionDeclaration`, `src/friction.ts`;
 * `Chain.pendingDir` — `validatePendingDirDeclaration`,
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
 * A glob form this dialect reads as a literal and nearly every other glob
 * dialect reads as an operator — the shape {@link matchesAny} can only
 * silently match nothing.
 *
 * `form` names the characters as they read in the glob; `dialect` names what
 * they mean where they came from. Unexported: the one caller that reads the
 * two fields is {@link foreignGlobRefusal} below, which turns them into the
 * sentence a refusing load raises, so exporting the type would be public
 * surface with no consumer (`.claude/rules/engineering.md`, *An export earns
 * its consumer*). What the dialect is, and which spellings are foreign to it,
 * are this module's facts — the same reason `matchesAny` lives here rather
 * than beside each enforcer.
 */
interface ForeignGlobForm {
  /** The offending characters, as prose naming what the glob opened with or carried. */
  form: string;
  /** Where that form comes from and what it means there. */
  dialect: string;
}

/**
 * The two decidable foreign forms (spec/pending.md, *The entry-scoped write
 * guard is opt-in, and off by default*): a leading `!` and a `{…,…}`
 * alternation. Both compile here to a literal — `globToRegex` escapes `!`,
 * `{`, `}` and `,` like any other non-wildcard — so the fence they were
 * meant to carve admits nothing at all, and every path the author believed
 * fenced is fenced by a different glob or by none.
 *
 * Only these two, and only where they are decidable: a `!` anywhere but the
 * first character is a literal in the dialects that spell negation too, and
 * a brace pair with no comma expands to itself in the dialects that spell
 * brace sets. Guessing past that is reading intent out of punctuation
 * (`.claude/rules/engine-boundary.md`, *Told, not inferred*) — a path whose
 * name genuinely holds a brace is a path, and the matcher already matches it.
 *
 * `undefined` for every other glob, which is the overwhelming majority: this
 * is a refusal over two spellings, not a grammar the engine imposes on a
 * fence.
 */
export function foreignGlobForm(glob: string): ForeignGlobForm | undefined {
  if (glob.startsWith("!")) {
    return {
      form: "opens with `!`",
      dialect:
        "a negation in gitignore, minimatch and picomatch, excluding what " +
        "the globs before it admitted",
    };
  }
  if (/\{[^{}]*,[^{}]*\}/.test(glob)) {
    return {
      form: "holds a `{…,…}` alternation",
      dialect:
        "a set in brace-expansion dialects (bash, minimatch, picomatch), " +
        "standing for each of its branches in turn",
    };
  }
  return undefined;
}

/**
 * The refusal a load raises over a glob written in a dialect this engine does
 * not read, or `undefined` when the glob is one this dialect can match.
 *
 * The whole sentence lives here, not just the two forms: what the characters
 * mean where they came from is {@link foreignGlobForm}'s fact, and what
 * {@link matchesAny} does with them instead — escape them, match the path
 * that spells them — is this module's. Two loads refuse over it, the engine's
 * chain load (`src/chainLoad.ts`) and the harness package's declaration parse
 * (`harness/declaration.ts`), and each knows only which field it was reading;
 * a message composed at each would be the matcher's rule spelled twice, one
 * edit from two answers (`.claude/rules/engineering.md`, *The fix lands at
 * the mechanism*). The caller prefixes the field it read and nothing else, so
 * the glob leads the clause and the whole message names it once.
 */
export function foreignGlobRefusal(glob: string): string | undefined {
  const foreign = foreignGlobForm(glob);
  if (!foreign) return undefined;
  return (
    `${JSON.stringify(glob)} ${foreign.form}: that is ${foreign.dialect}, ` +
    `and a literal character in flume's dialect — path matching is ` +
    `matchesAny, where regex specials are escaped and '*' and '**' are the ` +
    `only wildcards, so this glob matches only a path spelling it exactly. ` +
    `Spell the paths out, or narrow with '*' and '**'.`
  );
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
 * work, and `checkVerb` (`src/cliCheck.ts`) answering the same question for
 * an operator off the tick path. Each used to spell the `writablePaths ∪
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
 * The distinctness suffix a composed name carries when the fold that produced
 * it is lossy: ten hex characters of `identity`'s SHA-1.
 *
 * One spelling, because two callers key names on it and a second would let
 * them disagree about what "distinct" means: {@link boundedName} below, whose
 * truncation drops a tail, and the checkout segment (`checkoutSegment`,
 * `src/git.ts`), whose {@link slugify} drops every character outside the ref
 * alphabet. Ten characters is a collision domain of 2^40 over the handful of
 * names one repository holds — not a cryptographic claim, a naming one.
 */
export function shortHash(identity: string): string {
  return createHash("sha1").update(identity).digest("hex").slice(0, 10);
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
  const hash = shortHash(identity);
  return `${name.slice(0, max - hash.length - 1)}-${hash}`;
}

/**
 * Whether a filename is dot-prefixed — the one spelling of "a placeholder
 * git made the consumer create is no work". Every friction-channel surface
 * that decides whether a name is a note shares it (spec/chain.md,
 * "`Chain.friction` — the declared friction channel"), and it has exactly one
 * caller to share it through: `frictionNotes` (`src/friction.ts`), the
 * channel's one listing, behind the status count, the `friction` verb's bare
 * list, the teardown harvest's candidates — which would otherwise relay a
 * skipped name into the primary dir under a stamped one the readers can no
 * longer skip — and the harness package's window. The `friction` verb's
 * read-by-name (`frictionVerb`, `src/cliFriction.ts`) resolves a name the
 * operator typed rather than one it listed, and reaches this test through
 * that listing rather than asking it a second time, so a typed name and a
 * listed one are judged alike. One detection, never re-derived beside each
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
 * Exported because a consumer that needs the bare name has no path to take
 * it off: an adoption writing the default into a declaration, a probe
 * comparing a directory's own basename, a refusal quoting the dir it could
 * not stat. Each such site says at its own site why the name and not an
 * accessor; which sites those are is the program's answer, not a roster kept
 * here by hand (`.claude/rules/engineering.md`, *Derived state is computed,
 * never restated beside its source*). Everything that builds a path takes an
 * accessor below.
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
 * (`flumeDir`) — every entry the engine writes there, which is the literal
 * below and not a list repeated in this sentence. Writer and reader of each
 * of them sit in different modules (`flume stop` refuses, the supervisor
 * honors; `flume loop` claims the lock, `liveLoopClaim` reads it back), so a
 * copy of the name in each is a rename away from a silent bypass — this is
 * the one place any of them is spelled (`.claude/rules/engineering.md`,
 * "Derived state is computed, never restated beside its source").
 *
 * Exported because a consumer that needs a bare name has no path to take it
 * off: an ignore set spelling these entries as patterns, a probe matching a
 * bay's own entries against them, a diagnostic quoting the file it could not
 * read. Each such site says at its own site why the name and not an
 * accessor; which sites those are is the program's answer, not a roster kept
 * here by hand (`.claude/rules/engineering.md`, *Derived state is computed,
 * never restated beside its source*). Everything that builds a path takes an
 * accessor below.
 */
export const STATE_ROOT_NAMES = {
  awake: "awake",
  held: "held",
  priorAttempts: "prior-attempts",
  renderedPrompts: "rendered-prompts",
  worktrees: "worktrees",
  merging: "merging",
  loopLock: "loop.pid",
  stopFlag: "stop",
  runEnd: "run-end.json",
  tickVerdict: "tick-verdict",
  tickVerdictsLog: "tick-verdicts.jsonl",
  invocations: "invocations",
} as const;

/**
 * `at` — now, by default — in the filesystem-safe form every
 * timestamp-prefixed runtime filename uses (`:` and `.` are not portable in a
 * path component). One writer for the format, so a session capture, a revert
 * note, a friction harvest, and a rendered-prompt record all sort and parse
 * alike.
 *
 * The form is fixed-width and ISO-derived, so it sorts chronologically as
 * plain text. That is what the instant argument is for: a reader bounding a
 * window over these names renders the window's own edge through this writer
 * and compares strings, rather than parsing a stamp back out of a filename
 * (`flume status`'s live-run spend, `src/runSpend.ts`). One spelling of the
 * format, on both sides of the seam.
 */
export function fsStamp(at: Date = new Date()): string {
  return at.toISOString().replace(/[:.]/g, "-");
}

/** The baton's awake-flag dir — `<flumeDir>/awake` (`src/Baton.ts`). */
export function awakeDir(flumeDir: string): string {
  return join(flumeDir, STATE_ROOT_NAMES.awake);
}

/**
 * The baton's hold-marker dir — `<flumeDir>/held` (`src/Baton.ts`). A second
 * directory beside {@link awakeDir} rather than a second thing an awake flag
 * carries: a hold outranks a wake, so it has to survive the flag being
 * removed and re-stood, and a marker whose whole content is its own presence
 * cannot be half-written (spec/loop.md, *Baton — presence wakes, absence
 * hibernates*).
 */
export function heldDir(flumeDir: string): string {
  return join(flumeDir, STATE_ROOT_NAMES.held);
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
 * Same split as {@link tickVerdictDir}: this module owns the name so the
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
 * stakes it here (`stakePidClaim`, `src/pidClaim.ts`); `liveLoopClaim` and
 * `flume status` read it back.
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
 * The run-end record — `<flumeDir>/run-end.json` (`src/runEnd.ts`). One file
 * per state root, overwritten by each run that ends: the question it answers
 * is how the *last* run ended, so a history beside it would be a second
 * artifact nothing asks of it.
 */
export function runEndPath(flumeDir: string): string {
  return join(flumeDir, STATE_ROOT_NAMES.runEnd);
}

/**
 * The directory holding one latest-tick verdict per phase —
 * `<flumeDir>/tick-verdict`. A directory rather than a file because a
 * supervisor run holds several children at once, one per awake phase, and a
 * single path would have every child but the last one overwritten before the
 * supervisor read it.
 *
 * Same split as {@link mergingDir}: this module owns the name so the runtime
 * ignore set can reach it without importing the verdict's I/O, and
 * `src/tickVerdict.ts` owns what each file carries and when.
 */
export function tickVerdictDir(flumeDir: string): string {
  return join(flumeDir, STATE_ROOT_NAMES.tickVerdict);
}

/**
 * One phase's latest verdict — `<flumeDir>/tick-verdict/<phase>.json`,
 * overwritten every real `flume tick` of that phase and removed by
 * `clearTickVerdict` before that tick's own work begins.
 *
 * Keyed by the phase name exactly as the chain declares it, the way
 * `Baton`'s awake flag under {@link awakeDir} already is: a phase never runs
 * twice at once (spec/loop.md, *Baton — presence wakes, absence hibernates*)
 * and the supervisor names each child's phase on the way in, so the reader
 * opens the file it named the child by.
 * No slug, for the same reason the baton takes none — two spellings of a
 * phase's own filename is how a flag and a verdict come to disagree about
 * which phase they belong to.
 */
export function tickVerdictPath(flumeDir: string, phase: string): string {
  return join(tickVerdictDir(flumeDir), `${phase}.json`);
}

/**
 * The append-only verdict history `readTickVerdicts` (`src/tickVerdict.ts`)
 * reads back for a chain's recent-tick rendering. Same split as
 * {@link tickVerdictDir}: the name here, the semantics there.
 */
export function tickVerdictsLogPath(flumeDir: string): string {
  return join(flumeDir, STATE_ROOT_NAMES.tickVerdictsLog);
}

/**
 * The directory holding one running tick's usage rows per phase —
 * `<flumeDir>/invocations`. Keyed by phase for the same reason
 * {@link tickVerdictDir} is: a supervisor run holds one child per awake
 * phase, and the rows two children write concurrently must not land in one
 * another's file.
 *
 * Same split as {@link tickVerdictDir}: this module owns the name so the
 * runtime ignore set can reach it without importing the rows' I/O, and
 * `src/tickVerdict.ts` owns what the file carries and when.
 */
export function invocationsDir(flumeDir: string): string {
  return join(flumeDir, STATE_ROOT_NAMES.invocations);
}

/**
 * One phase's in-progress usage rows — `<flumeDir>/invocations/<phase>.jsonl`,
 * appended to as each of that tick's agents returns and removed before the
 * next tick of that phase begins its own work.
 *
 * Keyed by the phase name exactly as the chain declares it, on the same rule
 * as {@link tickVerdictPath}: a phase never runs twice at once, so the file
 * is one tick's, and the verdict written at the end of that tick composes
 * `invocations[]` from it.
 */
export function invocationsPath(flumeDir: string, phase: string): string {
  return join(invocationsDir(flumeDir), `${phase}${INVOCATIONS_EXT}`);
}

/** The suffix {@link invocationsPath} names a phase's rows file with. */
const INVOCATIONS_EXT = ".jsonl";

/**
 * The phase whose rows file is named `name`, or `undefined` when `name` is
 * not one — the inverse of {@link invocationsPath}'s naming, beside it so a
 * reader enumerating {@link invocationsDir} and the writer that filled it
 * cannot part over the suffix (`.claude/rules/engineering.md`, *A seam gate
 * reads what the real writer wrote*). An empty phase name is no phase, so a
 * bare `.jsonl` reads as not a rows file.
 */
export function invocationsPhaseOf(name: string): string | undefined {
  if (!name.endsWith(INVOCATIONS_EXT)) return undefined;
  const phase = name.slice(0, -INVOCATIONS_EXT.length);
  return phase === "" ? undefined : phase;
}

/**
 * The pending queue's directory when `Chain.pendingDir` is undeclared,
 * relative to the state root (spec/pending.md "The pending queue"). Callers
 * that resolve against a state root want {@link resolvePendingDir}; this is
 * for the ones that report the relative form to an operator.
 */
export const DEFAULT_PENDING_REL = join("plan", "pending");

/**
 * The queue directory a state root actually reads: the chain's declared
 * `pendingDir` when it has one, {@link DEFAULT_PENDING_REL} otherwise,
 * resolved against `stateRoot`. Every consumer of the queue — the
 * dispatcher, `flume check`, `flume status` — resolves it here, so an
 * undeclared queue is the same absolute directory on all of them.
 */
export function resolvePendingDir(stateRoot: string, declared?: string): string {
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
 * (spec/chain.md "Chain residency — one chain per `.flume`").
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
 * residency — one chain per `.flume`"). Resolved, never joined: a relative
 * `promptPath` keeps its meaning beneath the config dir, and an absolute one
 * is taken as given — which is how a prompt shipped inside a package gets an
 * address rather than a path the chain is assumed to hold beneath itself.
 *
 * Both dispatcher render sites — singleton and fanout — read the prompt from
 * here, so neither can address a phase's prompt differently from the other.
 */
export function phasePromptPath(configDir: string, promptPath: string): string {
  return resolve(configDir, promptPath);
}
