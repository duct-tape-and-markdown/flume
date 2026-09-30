/**
 * priorAttempts — the prior-attempt record's own home: where a record lives,
 * how it is read, written, cleared and swept, the durable snapshot of a
 * gate-reverted commit's files, and the per-mode builders that mint each
 * variant.
 *
 * Split out of `src/Dispatcher.ts` (`.claude/rules/engineering.md`, *A module
 * is one job*): persistence of the retry's input is a job of its own — one
 * directory, one file shape, one keyspace rule — and it depends on nothing
 * the dispatcher holds beyond the three values {@link PriorAttemptStore} is
 * constructed with. The dependency runs one way: the dispatcher calls in
 * here, nothing here calls back.
 *
 * spec/loop.md "Prior-outcome feedback to the retrying tick" is the contract
 * every shape below serves — a record is anchored, keyspaced, bounded, and
 * never a false signal.
 */

import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, toNamespacedPath } from "node:path";

import { bound, headTailBound, tailBound } from "./bounds.js";
import { entryDeclaredKey } from "./entryKey.js";
import type { Logger } from "./log.js";
import {
  existsLoudUnder,
  isDirectoryOrAbsent,
  isDirectoryOrAbsentUnder,
} from "./fsProbe.js";
import * as git from "./git.js";
import { priorAttemptsDir, slugify } from "./paths.js";
import type { PendingEntry } from "./PendingSchema.js";
import type { Phase } from "./Phase.js";
import type {
  InlineExecRenderError,
  MissingPlaceholderRenderError,
  RenderRefusal,
} from "./Prompt.js";
import { isPriorAttemptMode } from "./Prompt.js";
import type {
  PriorAttempt,
  PriorAttemptKeyspace,
  GateRevertAttempt,
  CleanExitAttempt,
  PlatformPreemptAttempt,
  RenderRefusedAttempt,
  TipMovedAttempt,
  NotShippedAttempt,
} from "./Prompt.js";

/**
 * One `PriorAttempt` variant as a builder produces it: before
 * {@link PriorAttemptStore.write} stamps the `headSha`/`at` anchor, the `key`
 * keyspace, the `keyedAs` written identity and the `declaredAs` declaration
 * key. The one home for that key list — every arm of
 * {@link PriorAttemptDraft} and every `build*` return below is spelled
 * through here, so a field `write` starts or stops stamping moves once
 * instead of per site.
 */
type Unstamped<A extends PriorAttempt> = Omit<
  A,
  "headSha" | "at" | "key" | "keyedAs" | "declaredAs"
>;

/**
 * What each mode-specific builder below actually produces. Kept as an
 * explicit union (rather than one {@link Unstamped} distributed over
 * `PriorAttempt`) so each arm still carries its own mode-specific fields
 * rather than collapsing to their shared `mode` key.
 */
export type PriorAttemptDraft =
  | Unstamped<GateRevertAttempt>
  | Unstamped<CleanExitAttempt>
  | Unstamped<PlatformPreemptAttempt>
  | Unstamped<RenderRefusedAttempt>
  | Unstamped<TipMovedAttempt>
  | Unstamped<NotShippedAttempt>;

/**
 * Where one prior-attempt record lives and which keyspace that place belongs
 * to: `key` is the identity the record is written under — an entry tag slug
 * or a phase name exactly as the chain spells it, which
 * {@link priorAttemptStem} slugifies into the filename stem and
 * {@link PriorAttemptStore.write} stamps verbatim onto the record's
 * {@link PriorAttempt.keyedAs}; `keyspace` is the {@link PriorAttempt.key}
 * value stamped alongside it; `declaredAs` is the entry **as declared** that
 * the record stands against ({@link PriorAttempt.declaredAs}) — present for an
 * entry ref, absent for a phase's, which has no declaration to hash. Produced
 * only by {@link priorAttemptRef}, so the three cannot disagree.
 */
export interface PriorAttemptRef {
  key: string;
  keyspace: PriorAttemptKeyspace;
  declaredAs?: string;
}

/**
 * Every keyspace a record can belong to, as a value — the directory names
 * {@link priorAttemptStem} scopes a stem under and the set
 * {@link PriorAttemptStore.readAll} enumerates. Exhaustive over
 * {@link PriorAttemptKeyspace} by type, so a keyspace the union gains must be
 * given its directory here rather than silently going unread on disk.
 */
const KEYSPACES: Record<PriorAttemptKeyspace, true> = {
  entry: true,
  phase: true,
};

/**
 * The subject this store's descents name when they refuse — one spelling for
 * every rung, whichever probe walks it and whichever reader runs it
 * (`isDirectoryOrAbsentUnder` down to `prior-attempts/`,
 * `isDirectoryOrAbsent` across the keyspace fan, `existsLoudUnder` down to
 * one record; `src/fsProbe.ts`), so the state root and a keyspace dir refuse
 * alike whether {@link PriorAttemptStore.read} or
 * {@link PriorAttemptStore.readAll} walked into them.
 */
const STORE_SUBJECT = "prior-attempt store";

/** The same set as a list, for the enumeration `readAll` walks. */
const KEYSPACE_NAMES = Object.keys(KEYSPACES) as PriorAttemptKeyspace[];

/**
 * Whether a decoded record's `key` field names a keyspace this store knows —
 * the one reader of {@link KEYSPACES} that runs over untrusted JSON, so the
 * accepted set and the enumerated directories cannot drift apart.
 */
function isKeyspace(value: unknown): value is PriorAttemptKeyspace {
  return typeof value === "string" && Object.hasOwn(KEYSPACES, value);
}

/**
 * The key one record occupies in the map a chain reads
 * (`TickContext.priorAttempts`, spec/chain.md *What a hook receives*):
 * the keyspace and the written identity, joined — `entry:<tag slug>` for a
 * fanout record, `phase:<phase name>` for a singleton's. Both halves, because
 * the identity alone collides exactly where the stems used to: a phase named
 * `build` and a tag slugged `build` are two records, and a map keyed by the
 * identity would hand a `shouldRun` whichever of them was read last.
 */
function priorAttemptMapKey(ref: PriorAttemptRef): string {
  return `${ref.keyspace}:${ref.key}`;
}

/**
 * The key one entry's own record occupies in that map, for any reader holding
 * the entry rather than the ref — selection, which judges a chain's declared
 * per-entry refusal against the record standing for each entry it is about to
 * offer (`bindEntryRefusal`, `src/selection.ts`), and, outside the engine, a
 * consumer asking which of the queue's entries a refusal is still standing
 * against.
 *
 * Shipped from the package root (`src/index.ts`) for that second reader: the
 * join and the slug are this module's, and a second spelling of either — in
 * the engine or in a chain that had no engine spelling to reach for — is how
 * a lookup comes to miss a record the walk filed under a key it composed
 * differently (`.claude/rules/engineering.md`, *A fact the engine holds is
 * reported, never rediscovered*).
 */
export function entryAttemptKey(entry: PendingEntry): string {
  return priorAttemptMapKey({ key: slugify(entry.tag), keyspace: "entry" });
}

/**
 * The key one singleton phase's own record occupies in that map, the other
 * half of what {@link entryAttemptKey} answers for a fanout entry. A
 * singleton tick carries no queue entry, so the phase is the identity — and
 * the phase half is the one where the identity rule differs: the name is
 * keyed **as the chain spells it**, never slugged the way a tag is, so a
 * caller composing the join by hand gets it wrong in exactly the cases where
 * the stem on disk and the map key diverge.
 *
 * Derived through {@link priorAttemptRef}, the same rule
 * {@link PriorAttemptStore.write} keys the record by, so the lookup and the
 * write cannot drift.
 *
 * Shipped from the package root beside its two siblings: with only the entry
 * and record keyers exported, a chain asking "does this phase have a standing
 * record?" had no engine spelling to reach for and composed
 * `phase:${phase.name}` itself — a second copy of a join the engine owns
 * (`.claude/rules/engineering.md`, *A fact the engine holds is reported,
 * never rediscovered*).
 */
export function phaseAttemptKey(phase: Phase): string {
  return priorAttemptMapKey(priorAttemptRef(phase));
}

/**
 * The ref a persisted record was written under, read back off the record's
 * own stamped fields — the inverse of what {@link PriorAttemptStore.write}
 * stamps. `clearStale` re-derives the path of a record it enumerated this
 * way rather than from the filename it found it at, so the identity that
 * keys the map is the identity that keys the removal.
 */
function refOfRecord(rec: PriorAttempt): PriorAttemptRef {
  return {
    key: rec.keyedAs,
    keyspace: rec.key,
    ...(rec.declaredAs === undefined ? {} : { declaredAs: rec.declaredAs }),
  };
}

/**
 * The key one record occupies in that map, for a reader holding the record
 * rather than the entry — {@link PriorAttemptStore.readAll}, which files each
 * record it decoded under it, and the harness package's own records block,
 * which orders the standing records a tick is shown by the identity they were
 * filed under (`harness/inboxWindow.ts`).
 *
 * Covers both keyspaces where {@link entryAttemptKey} covers the entry
 * keyspace alone: a record carries its own two halves, so the key is read off
 * it rather than composed from a keyspace the caller had to assume. A reader
 * re-spelling those halves holds a copy of the join that goes quietly wrong
 * the day the engine changes how it keys — which is why the join is answered
 * here and never left to the side holding the record
 * (`.claude/rules/engineering.md`, *A fact the engine holds is reported,
 * never rediscovered*).
 *
 * Shipped from the package root beside {@link entryAttemptKey}: the record is
 * what a consumer holds after iterating the map, so the side most likely to
 * re-spell the join is the one outside the engine.
 */
export function recordAttemptKey(rec: PriorAttempt): string {
  return priorAttemptMapKey(refOfRecord(rec));
}

/**
 * Prior-attempt records live beside the baton, under `priorAttemptsDir`
 * (`src/paths.ts`, which owns the name): gitignored harness runtime state
 * under the flume state dir, NOT in the per-entry worktree (a fanout retry
 * gets a fresh worktree; the record must outlive it). One JSON file per ref —
 * the entry tag slug (fanout) or phase name (singleton), under its own
 * keyspace's subdirectory.
 *
 * Re-exported here because that is where a chain reaches it from
 * (`src/index.ts`, `src/flumeApi.ts`). The records themselves sit one level
 * down, under the keyspace they belong to
 * (`<flumeDir>/prior-attempts/<keyspace>/<slug>.json`).
 *
 * Session logs sit alongside under the same root (the dogfood chain places
 * them at `<flumeDir>/sessions/`), but that placement is chain-supplied, not
 * runtime: the runtime owns only `flumeDir` itself and the baton/prior-attempt
 * dirs it derives from it. A chain that captures sessions roots them under
 * `api.paths.flumeDir` (spec/chain.md, *Per-run artifacts belong under
 * `FLUME_DIR`*) so the whole footprint tears down in one `rm`.
 */
export { priorAttemptsDir };

/**
 * The keyed stem under `priorAttemptsDir` that every artifact of one prior
 * attempt hangs a suffix off — the record JSON ({@link priorAttemptPath})
 * and the reverted-file snapshot dir
 * ({@link PriorAttemptStore.snapshotDir}). One `slugify` for both, so the
 * two artifacts of a single attempt are named by one identity and neither
 * can be keyed by a raw tag that walks out of the dir
 * (`.claude/rules/engineering.md`, "The fix lands at the mechanism").
 *
 * Scoped by the ref's keyspace, not by its identity alone: `slugify` maps a
 * phase name and an entry tag onto one text as readily as not — a phase
 * named `build` and a tag `BUILD` slug alike — and two attempts sharing a
 * stem is one overwriting the other's record and inheriting its snapshot.
 * The keyspace is a closed set this module spells ({@link KEYSPACES}), never
 * caller text, so the scoping segment cannot itself walk out of the dir.
 */
function priorAttemptStem(flumeDir: string, ref: PriorAttemptRef): string {
  return join(priorAttemptsDir(flumeDir), ref.keyspace, slugify(ref.key));
}

/**
 * Filesystem path of one prior-attempt record
 * (spec/loop.md "Prior-outcome feedback to the retrying tick": "the exported
 * rule"). Takes the {@link PriorAttemptRef} whole — keyspace and identity
 * travel together, so a caller cannot name a record without saying which of
 * the two keyspaces it belongs to. Slugifies internally — idempotent on an
 * already-slugified key — so a chain-authored `shouldRun` can derive the same
 * path the dispatcher itself reads and writes from nothing but the raw
 * tag/phase name it already has, with no private dispatcher rule to
 * reverse-engineer.
 */
export function priorAttemptPath(
  flumeDir: string,
  ref: PriorAttemptRef,
): string {
  return `${priorAttemptStem(flumeDir, ref)}.json`;
}

/** Telegraphic-prose bound on persisted gate details — a digest, not a transcript. */
const MAX_PRIOR_DETAILS = 8 * 1024;
/**
 * Share of {@link MAX_PRIOR_DETAILS} reserved for the *tail* of a gate's
 * captured output — enough for a reporter's closing summary, small enough
 * that the head keeps a multi-failure block whole. See {@link headTailBound}.
 */
const MAX_PRIOR_DETAILS_TAIL = 1024;
/** Bound on the persisted `git show --stat` digest. */
const MAX_PRIOR_DIFFSTAT = 4 * 1024;
/**
 * The digest of a span that added nothing to the tip it reverts from — the
 * tip held the span's content whole, so the pick had no commit to add. Stated
 * rather than left blank: a retry reading an empty digest cannot tell "added
 * nothing" from "the capture failed", and either reading beats inferring
 * one from a foreign commit's diffstat.
 */
const NO_SPAN_DIFFSTAT = "(no commit added to the tip)";
/**
 * The digest of a span whose `git show --stat` could not be read at all —
 * the other half of the distinction {@link NO_SPAN_DIFFSTAT} draws. A retry
 * reading this one knows what the span added is *unknown*; reading that one
 * knows it added nothing. What warrants substituting either rather than
 * failing the record is {@link capturedDiffStat}'s.
 */
const UNREADABLE_SPAN_DIFFSTAT = "(diff stat unavailable)";
/**
 * Bound on the persisted clean-exit constraint / platform-preempt
 * failure class. Same telegraphic discipline as the gate digest: enough to
 * name the wall, not the transcript.
 */
const MAX_PRIOR_NOCOMMIT = 4 * 1024;
/**
 * What a clean-exit record forwards when the agent's final message came back
 * empty — the one signal that record exists to carry was not there to read.
 * Stated rather than left blank so the retry reads "nothing was said" in the
 * message's position instead of an empty quote; which of the mode's two exits
 * happened is `spanBase`/`spanHead`'s to say, never this string's, and
 * {@link buildCleanExit} spells why.
 */
const NO_FINAL_MESSAGE =
  "(agent exited cleanly and produced no final message)";
/**
 * Bound on the persisted not-shipped record's path list. A footprint, like a
 * diffstat, names what landed — a few hundred lines is already past what the
 * retry reads, and the record renders straight into a prompt.
 */
const MAX_PRIOR_TOUCHED_PATHS = 200;

/**
 * Where a phase/entry's prior-attempt record lives: the entry tag slug for
 * fanout, the phase name for singleton. A retry is scheduled "for that
 * same entry (fanout) or phase (singleton)" — the key mirrors exactly that
 * scope so the next tick reads its own predecessor.
 *
 * Key and keyspace are derived here together and travel as one value:
 * which keyspace a stem belongs to is not recoverable from its text, and
 * a pair threaded as two parameters is a pair a callsite can mismatch. The
 * entry arm derives the declaration key with them
 * ({@link PriorAttempt.declaredAs}) from the same entry, so no write callsite
 * composes it and none can stamp a record against a declaration other than
 * the one the ref is keyed by.
 */
export function priorAttemptRef(
  phase: Phase,
  entry?: PendingEntry,
): PriorAttemptRef {
  return entry
    ? {
        key: slugify(entry.tag),
        keyspace: "entry",
        declaredAs: entryDeclaredKey(entry),
      }
    : { key: phase.name, keyspace: "phase" };
}

/**
 * The prior-attempt record directory, bound to one run's state root.
 *
 * A class rather than free functions taking `flumeDir` at every call: the
 * three values below are fixed for the life of a Dispatcher, and threading
 * them through a dozen callsites is a dozen chances to pass the worktree's
 * root where the trunk's belongs (`write` in particular anchors on the
 * *trunk* tip, whichever worktree produced the record).
 */
export class PriorAttemptStore {
  constructor(
    /** The flume state root every record path below is derived from. */
    private readonly flumeDir: string,
    /** The *trunk* repo root — the tip {@link write} anchors a record on. */
    private readonly repoRoot: string,
    private readonly log: Logger,
  ) {}

  /**
   * Read a persisted prior-attempt record, if any. Corrupt, carrying a
   * `mode` the engine's roster does not name (`PRIOR_ATTEMPT_MODES`,
   * src/Prompt.ts — the one list, never respelled here), missing the
   * `headSha`/`at` anchor
   * every record carries (spec/loop.md "Every record is anchored"), or
   * missing the `key` keyspace / `keyedAs` written identity every record
   * states (spec/loop.md "No false signal"), or — in the entry keyspace —
   * missing the `declaredAs` declaration key such a record stands against →
   * treated as absent. `mode` alone does not make a
   * `PriorAttempt`: the renderer is exhaustive over the known modes and must
   * never be fed an unknown shape, and a chain comparing a record's `headSha` to the tip
   * reads a field the type promises is there. A record predating the anchor
   * is a stale slot, and a stale slot must never become a false signal —
   * and one predating `keyedAs` has no identity to key {@link readAll}'s map
   * by, which would put it in a chain's hands under `undefined`. One
   * predating `declaredAs` says nothing about *which* declaration it was
   * written against, so a refusal keyed on that (`spec/harness.md`, *The
   * phases*) could neither stand nor lift decidably — the record is absent
   * rather than a comparison against `undefined`
   * (`.claude/rules/engineering.md`, *Loud or nothing*).
   *
   * A record whose stated keyspace disagrees with the directory it was found
   * in is the same class of undecodable: the two sides of its identity
   * contradict each other, and honouring the stated one would file it in the
   * map under a key whose path — the one {@link clear} would later remove —
   * is not the file it came from. The identity half is held to the same bar,
   * and by the same test: the record's own ref must compose back through
   * {@link priorAttemptPath} to the file it was read from. A `keyedAs`
   * naming another record's file keys {@link readAll}'s map under an
   * identity no read reaches — the retry whose name it wears reads this
   * file's wall while its own reads none, and `clearStale` reports a key
   * cleared on every call while the file never leaves.
   */
  async read(ref: PriorAttemptRef): Promise<PriorAttempt | undefined> {
    const p = priorAttemptPath(this.flumeDir, ref);
    // Absent is the only silent reading, and it is *proven from the state
    // root* this store was constructed with: `existsLoudUnder`
    // (`src/fsProbe.ts`) asserts `prior-attempts/` and the keyspace dir are
    // directories before it stats the record — the same rungs `readAll`
    // descends, so the fan read and the single read prove one absence. A bare
    // stat cannot: an obstructed ancestor answers the leaf's own stat `ENOENT`
    // on win32 (`.claude/rules/platform-facts.md`, *win32 reports a path
    // through a non-directory as not found*), and the probe throws on a record
    // that is present but unstattable either way. "No prior attempt" is the
    // signal spec/loop.md "Repeated identical failures — quarantine, then
    // abort" counts on, so a record the probe cannot reach must refuse rather
    // than reset that count — the degradations below are for a record that
    // was *read* and found garbled, never for one that was never reached.
    if (!existsLoudUnder(STORE_SUBJECT, this.flumeDir, p)) return undefined;
    const raw = await this.readRecord(p);
    try {
      const rec = JSON.parse(raw) as {
        mode?: unknown;
        headSha?: unknown;
        at?: unknown;
        key?: unknown;
        keyedAs?: unknown;
        declaredAs?: unknown;
      };
      if (
        rec &&
        isPriorAttemptMode(rec.mode) &&
        typeof rec.headSha === "string" &&
        typeof rec.at === "string" &&
        isKeyspace(rec.key) &&
        rec.key === ref.keyspace &&
        typeof rec.keyedAs === "string" &&
        rec.keyedAs.length > 0 &&
        (rec.key !== "entry" ||
          (typeof rec.declaredAs === "string" && rec.declaredAs.length > 0))
      ) {
        const stated = rec as PriorAttempt;
        // The identity half of the agreement the keyspace half gets above,
        // asked of the path rule rather than of `slugify` directly: what
        // decides whether an identity names this file is the composition that
        // locates a record, never a second spelling of its fold
        // (`.claude/rules/engineering.md`, *The fix lands at the mechanism*) —
        // the same question the walk asks of a stem it found. A phase name
        // `slugify` rewrites passes: the record is keyed by the chain's own
        // spelling and sits at the slugged stem that spelling composes to.
        if (priorAttemptPath(this.flumeDir, refOfRecord(stated)) !== p)
          return undefined;
        return stated;
      }
      return undefined;
    } catch {
      // A garbled record must not crash the tick — degrade to "no prior".
      // The parse alone, over bytes already in hand: a statement about the
      // record's *contents*, never about whether it was read.
      return undefined;
    }
  }

  /**
   * The bytes at a record path the probe above found something at, or a
   * refusal naming that path.
   *
   * Outside {@link read}'s decode arm, because a file that would not open was
   * never read and so has nothing to be garbled about: a directory standing
   * at the path, a permission-denied leaf, an I/O error mid-read. Inside that
   * arm each read as "no prior attempt" and reset the repeated-failure count
   * spec/loop.md "Repeated identical failures — quarantine, then abort" keeps
   * (`.claude/rules/engineering.md`, *Loud or nothing*) — the same split
   * `readTickVerdict` (`src/tickVerdict.ts`) draws between its probe and its
   * parse.
   *
   * The path is this refusal's own to state, because a failure past the open
   * does not carry one (`.claude/rules/platform-facts.md`, *A read that fails
   * after the open names no path*): without it an operator is handed a store
   * of many record files and no file to go fix. The errno's own sentence
   * rides along as the detail, so nothing about the failure is lost.
   */
  private async readRecord(path: string): Promise<string> {
    try {
      return await readFile(toNamespacedPath(path), "utf8");
    } catch (err) {
      throw new Error(
        `[flume] prior-attempt record is unreadable: ${path} — ${
          err instanceof Error ? err.message : String(err)
        }`,
        { cause: err },
      );
    }
  }

  /**
   * Every persisted prior-attempt record under `<flumeDir>/prior-attempts/`,
   * keyed by the keyspace and the identity each record was **written** under
   * — `entry:<tag slug>`, `phase:<phase name>`
   * ({@link recordAttemptKey}) — not by the filename stem it happens to
   * sit at. For a fanout record the identity and the stem are the same text
   * (the ref's key is already a tag slug); for a singleton they diverge
   * whenever `slugify` rewrites the phase name, and it is the chain's own
   * spelling of that name a hook holds when it reaches for its record
   * (spec/chain.md "What a hook receives"). The stem still locates the file
   * — it is read back through {@link read}, whose `slugify` is idempotent on
   * it — and only the map key comes off the record.
   *
   * Walked one keyspace directory at a time, so which keyspace a record
   * belongs to is known from where it was found and never guessed from the
   * text of its stem.
   *
   * Absence is the only silent reading — nothing written is no records — and
   * it is **proven from the path**, never read off the errno a listing
   * happened to raise. A store that is present but cannot be enumerated — a
   * plain file sitting at the state root, at `prior-attempts/` or at a
   * keyspace directory, permission denied, a path too long for the platform
   * — escapes. This map feeds every `TickContext.priorAttempts` a tick's
   * hooks read, so an unreachable store reported as an empty map tells every
   * `shouldRun` "no prior attempt" and silently resets the repeated-failure
   * count spec/loop.md "Repeated identical failures — quarantine, then
   * abort" keeps — the same refusal {@link read} makes per file, where the
   * degrade to "no prior" is only ever for a record that was *read* and
   * found garbled. Per file the reading is {@link read}'s whole: a record
   * this listing finds and cannot open escapes here exactly as it does
   * there, because the walk selects by name and leaves the reading to the
   * reader. The walk keeps one refusal of its own, for the one failure the
   * reader cannot see: a stem the record path rule does not compose back to
   * the file it was found at, which no `read` or `clear` can reach and which
   * `read` would therefore report as absent.
   *
   * Hence the descent: the state root, then `prior-attempts/`, then each
   * keyspace directory, each proven a directory before the next is probed.
   * The root and the one directory beneath it are a contiguous walk, so they
   * go through {@link isDirectoryOrAbsentUnder} (`src/fsProbe.ts`), which
   * composes those rungs for every reader running this descent —
   * `readMergingMarkers` included; the keyspaces are a fan of siblings under
   * a root already proven, which is the shape {@link isDirectoryOrAbsent}'s
   * own list exists for. An errno is not that proof
   * (`.claude/rules/platform-facts.md`, *win32 reports a path through a
   * non-directory as not found*), so an errno-keyed silent arm reads one
   * host's obstructed store as an empty one. The state root is where the
   * descent starts: the store is constructed with it, and what stands above
   * it is the caller's to answer for.
   */
  async readAll(): Promise<ReadonlyMap<string, PriorAttempt>> {
    const out = new Map<string, PriorAttempt>();
    const root = priorAttemptsDir(this.flumeDir);
    if (!isDirectoryOrAbsentUnder(STORE_SUBJECT, this.flumeDir, root))
      return out;
    for (const keyspace of KEYSPACE_NAMES) {
      const dir = join(root, keyspace);
      if (!isDirectoryOrAbsent(STORE_SUBJECT, dir)) continue;
      // Every ancestor is proven above, so a listing failure here is real:
      // a keyspace dir that vanished mid-walk, or one that cannot be read.
      //
      // Names, not dirents: what a listed entry *is* has no bearing on
      // whether this store must answer for it, and asking would only give
      // the walk a second chance to decide something `read` already
      // decides. Whether a record opens is the read's alone — a dirent type
      // consulted here drops a directory, a symlink, anything but a plain
      // file at a record path ahead of the read that refuses on it, and
      // files it under the one reading that read never makes: no prior
      // attempt (`.claude/rules/engineering.md`, *Loud or nothing*).
      const names = await readdir(toNamespacedPath(dir));
      for (const name of names) {
        // The name decides twice, and the suffix is the silent half: something
        // not named like a record was never this store's to answer for.
        if (!name.endsWith(".json")) continue;
        const found = join(dir, name);
        const stem = name.slice(0, -".json".length);
        // The loud half. A record is located by its stem, and `read` puts
        // that stem back through the store's own path rule, whose `slugify`
        // is idempotent on a key already slugged and rewrites every other:
        // a stem carrying anything outside the slug alphabet re-composes to
        // a *different* file, where the probe answers absent and a record
        // this walk enumerated and accepted reads as no prior attempt.
        //
        // Such a file is not merely mislaid, it is unreachable: no `read`
        // finds it, no `clear` removes it, and no retry it was written for
        // can ever see it. So the failure is stated here, at the one surface
        // that can see the file at all, rather than degraded into the
        // reading that resets the repeated-failure count spec/loop.md
        // "Repeated identical failures — quarantine, then abort" keeps
        // (`.claude/rules/engineering.md`, *Loud or nothing*). Asked of the
        // path rule rather than of `slugify` directly, so the round trip is
        // judged against the composition that actually locates a record and
        // not against a second spelling of its fold
        // (`.claude/rules/engineering.md`, *The fix lands at the mechanism*).
        // Nothing `write` produces can trip it: every stem it composes is
        // already this rule's own output.
        if (priorAttemptPath(this.flumeDir, { key: stem, keyspace }) !== found)
          throw new Error(
            `[flume] prior-attempt record sits at a path this store cannot name: ${found} — its stem is not what the record path rule composes for it, so no read, clear or retry reaches it`,
          );
        const rec = await this.read({ key: stem, keyspace });
        if (rec) out.set(recordAttemptKey(rec), rec);
      }
    }
    return out;
  }

  /**
   * Stamps `headSha`/`at` (spec/loop.md "Every record is anchored") and the
   * writing ref's keyspace, key and declaration key onto whatever mode-specific
   * fields the caller built, so every one of the `build*` functions below stays ignorant of
   * the anchor rather than each re-reading the trunk tip itself. `repoRoot`,
   * never `key`'s worktree — the anchor is the *trunk* tip regardless of
   * which worktree produced the record.
   */
  async write(ref: PriorAttemptRef, rec: PriorAttemptDraft): Promise<void> {
    const p = priorAttemptPath(this.flumeDir, ref);
    const anchored: PriorAttempt = {
      ...rec,
      key: ref.keyspace,
      // The ref's key verbatim, not the slugged stem `p` sits at: this is
      // the identity `readAll` keys a chain's map by, and a phase name
      // `slugify` rewrites must still answer to the name the chain spells.
      keyedAs: ref.key,
      // From the ref, for an entry ref alone: an entry-keyed record must
      // carry the declaration it stands against for `read` above to accept
      // it, and a phase ref has none to carry.
      ...(ref.declaredAs === undefined ? {} : { declaredAs: ref.declaredAs }),
      headSha: await git.revParse(this.repoRoot),
      at: new Date().toISOString(),
    };
    await mkdir(toNamespacedPath(dirname(p)), { recursive: true });
    await writeFile(
      toNamespacedPath(p),
      JSON.stringify(anchored, null, 2) + "\n",
      "utf8",
    );
  }

  /**
   * Clear a prior-attempt record once a later attempt commits clean — both
   * the record JSON and the reverted-prose snapshot, so a clean ship leaves
   * no stale recovery artifact (the same no-false-signal invariant the
   * record slot already holds, extended to the prose snapshot).
   */
  async clear(ref: PriorAttemptRef): Promise<void> {
    await rm(toNamespacedPath(priorAttemptPath(this.flumeDir, ref)), {
      force: true,
    });
    await rm(toNamespacedPath(this.snapshotDir(ref)), {
      recursive: true,
      force: true,
    });
  }

  /**
   * Clear every entry-keyed prior-attempt record whose tag the queue no
   * longer carries, and report the keys cleared (spec/loop.md "No false
   * signal"). Such a record can never be read again on its own terms — the
   * retry it was written for will not happen — but it stays visible to
   * every `shouldRun`/`promptArgs` reading `TickContext.priorAttempts`, and
   * a tag reused later would inherit a predecessor it never had.
   *
   * Keyed on the record's own `key` keyspace, never on the written
   * identity's text: a phase's record is named by a phase name, which no
   * queue ever carries, so a text-only test would clear the singleton
   * records the queue has no say over — and a phase whose name slugs onto a
   * retired tag is exactly the case where the two texts cannot tell the
   * keyspaces apart. Within the entry keyspace the identity is the tag slug
   * the ref wrote it under, which is what `queued` holds. The cleared keys
   * reported are the ones {@link readAll} keys by, so a chain reading the
   * verdict and a chain reading `TickContext.priorAttempts` name the same
   * record. Records that read as absent (corrupt, unanchored, no keyspace, an
   * identity naming another file) are not cleared — {@link readAll} never
   * surfaces them, and deleting a file this store cannot parse is a guess
   * about what wrote it. A reported key is therefore a file that left: the
   * removal is composed from the same identity the report is, so a key the
   * sweep names and a file it deletes cannot come apart.
   */
  async clearStale(pending: readonly PendingEntry[]): Promise<string[]> {
    const queued = new Set(pending.map((e) => slugify(e.tag)));
    const records = await this.readAll();
    const stale = [...records]
      .filter(([, rec]) => rec.key === "entry" && !queued.has(rec.keyedAs))
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    for (const [, rec] of stale) await this.clear(refOfRecord(rec));
    const keys = stale.map(([key]) => key);
    if (keys.length > 0) {
      this.log.info(
        `[flume] cleared ${keys.length} stale prior-attempt record(s): ${keys.join(", ")}`,
      );
    }
    return keys;
  }

  /**
   * Durable, gitignored snapshot dir for a gate-reverted commit's files.
   * Sibling to the prior-attempt JSON under `<flumeDir>/prior-attempts/`
   * (NOT the per-entry worktree) so it outlives both `git reset --hard` and
   * a fanout worktree teardown — the same durability that record relies on.
   *
   * Sibling in the literal sense: same {@link priorAttemptStem}, a different
   * suffix. Keying this dir by the raw text while the record beside it was
   * keyed by the slug made the two artifacts of one attempt disagree about
   * whose attempt they were, and left a traversing key to resolve outside
   * `priorAttemptsDir` entirely — which `clear` and
   * {@link snapshotReverted} then `rm -rf`.
   */
  snapshotDir(ref: PriorAttemptRef): string {
    return `${priorAttemptStem(this.flumeDir, ref)}.reverted`;
  }

  /**
   * Snapshot every non-deleted file the reverted span touched, verbatim,
   * into the durable snapshot dir before the hard reset destroys it.
   *
   * A gate-reverted tick otherwise loses everything the commit carried to
   * `git reset --hard` — including whatever prose the agent wrote once and
   * cannot restate, recoverable only by a human reading an agent transcript.
   * The snapshot is post-image content under a mirror of the repo path, so
   * recovery is "open the file" — not "read a diff", not "grep a session
   * log". `diffStat` (the record's digest) is `git show --stat`: filenames
   * and counts, never content — it cannot recover findings, which is why
   * this distinct artifact exists.
   *
   * **The span, never its head alone.** The digest beside this snapshot is
   * already taken over `base..head` ({@link capturedDiffStat}), and a tick
   * that committed more than once wrote prose in commits the head's own diff
   * never names. Listing one commit there made the artifact narrower than the
   * digest that advertises it: a finding written in the span's first commit
   * was named by the stat and recoverable only from a session log, which is
   * the one outcome spec/worktrees.md "Reverted prose survives the reset"
   * rules out. Content is read at `head` — the post-image the reset destroys
   * — so a path the span rewrote is snapshotted once, as it last stood.
   *
   * Generic by construction: it snapshots whatever the reverted span
   * changed, so the dispatcher needs no chain-specific notion of which
   * artifact is "prose" vs "machine-checkable", and names no chain's file.
   * Must run while the span is still reachable (before the drop).
   * Best-effort — a snapshot failure must never block or fail the revert; it
   * warns through the store's own logger instead, for the whole artifact and
   * for a single listed path alike, so the lost recovery content is stated
   * rather than left to be noticed.
   */
  async snapshotReverted(
    cwd: string,
    span: { base: string; head: string },
    ref: PriorAttemptRef,
  ): Promise<void> {
    const dir = this.snapshotDir(ref);
    try {
      // The artifact tracks the *latest* reverted attempt only — drop any
      // stale snapshot from an earlier revert under this ref first.
      await rm(toNamespacedPath(dir), { recursive: true, force: true });
      // Both reads go through `src/git.ts`, never a second `git show` spelled
      // here (`.claude/rules/engineering.md`, "The fix lands at the
      // mechanism"): the listing through the shared `-z` name-only decode, so
      // a quoted or space-terminated path arrives as git committed it and
      // still resolves as `<head>:<path>`; the content through the shared
      // tip-read.
      const files = await git.diffNameOnly(cwd, span.base, span.head, {
        excludeDeleted: true,
      });
      for (const rel of files) {
        // `excludeDeleted` already dropped everything the span removed, so a
        // null here means the head's tree hands back no blob at a path the
        // span's own listing named — a gitlink the range names as changed, or
        // a listing and a tree that disagree. Skip that path rather than
        // abandoning the rest of the snapshot to the catch below, which is
        // the whole artifact for the sake of one file.
        const content = await git.readFileAtRef(cwd, span.head, rel);
        if (content === null) {
          // Declared degraded-but-proceeding path, bounded the way the
          // whole-artifact catch below is (`.claude/rules/engineering.md`,
          // *Loud or nothing*): nothing downstream refuses on a snapshot
          // narrower than the span, and `capturedDiffStat` beside it still
          // advertises this path to the retrying tick — so an operator who
          // opens the snapshot looking for it finds an absence with no
          // account of itself. The warn is that account, naming the path at
          // the moment it is dropped.
          this.log.warn(
            `[flume] revert snapshot skipped ${rel}: ${span.head} holds no file there`,
          );
          continue;
        }
        const dest = join(dir, rel);
        // win32 MAX_PATH (`.claude/rules/platform-facts.md`): dest depth
        // here is driven by the reverted diff's own path depth, not
        // chain.friction, but it's the same join(dir, rel) unwrapped shape
        // writeRevertNote/harvestFriction guard use — same idiom.
        await mkdir(toNamespacedPath(dirname(dest)), { recursive: true });
        await writeFile(toNamespacedPath(dest), content, "utf8");
      }
    } catch (err) {
      // Declared degraded-but-proceeding path
      // (`.claude/rules/engineering.md`, *Loud or nothing*): recovery is
      // best-effort by spec, so nothing downstream refuses on the missing
      // snapshot and the revert runs on. What bounds it is this line — the
      // operator is told the recovery artifact is gone, and where it would
      // have been, at the moment it fails rather than by discovering an
      // absent directory later.
      this.log.warn(
        `[flume] revert snapshot failed: ${dir}: ${(err as Error).message}`,
      );
    }
  }
}

/**
 * Bounded `git show --stat` over the span this tick added — the
 * prior-attempt digest, so the retry does not blindly reconstruct. The span,
 * never its head sha alone: over a span the tip already held whole the pick
 * added no commit, and digesting the head would hand the retry the diff of
 * whichever writer left that commit standing there as its own prior attempt.
 * An empty range says so in words rather than falling through as a blank
 * block (`.claude/rules/engineering.md`, "Loud or nothing").
 *
 * Must be called while the span's head is still reachable (before the hard
 * reset / commit drop).
 *
 * Best-effort, and the warrant is the record's: a reverted tick that forwards
 * no signal leaves the loop amnesiac, re-deriving the wall it just hit, which
 * is what this record exists to close (`spec/loop.md`, *Prior-outcome
 * feedback to the retrying tick*). So the record still reaches the retry when
 * the digest cannot be read — a `git show --stat` failure is not worth the
 * gate name, message and details it rides with, nor the drop this runs ahead
 * of.
 *
 * Nothing downstream refuses on the substituted digest, so what bounds it is
 * where it lands visibly, as it does for the empty-range answer above: the
 * retrying tick's `<prior-attempt>` block, where a failed capture reads as
 * one rather than as a span that changed nothing
 * (`.claude/rules/engineering.md`, *Loud or nothing*).
 */
async function capturedDiffStat(
  cwd: string,
  span: { base: string; head: string },
): Promise<string> {
  try {
    const stat = await git.spanDiffStat(cwd, span);
    return stat.trim() === ""
      ? NO_SPAN_DIFFSTAT
      : bound(stat, MAX_PRIOR_DIFFSTAT);
  } catch {
    return UNREADABLE_SPAN_DIFFSTAT;
  }
}

/**
 * Build the gate-revert record: an afterCommit/afterMerge gate refused the
 * span and the engine dropped it. Carries the gate's own verdict and its own
 * attribution plus the bounded `git show --stat` of what the span added, so
 * the retry reads what landed instead of blindly reconstructing it.
 */
export async function buildGateRevert(
  when: GateRevertAttempt["when"],
  failure: {
    gate: string;
    message: string;
    verdict?: string;
    details?: string;
    failingFiles?: string[];
    blamesSpan?: false;
  },
  diffCwd: string,
  /**
   * The span the reverted work added, as a pair in the record's own direction
   * so a caller cannot transpose it: `base` the tip the span landed onto (or
   * branched from, afterCommit), `head` the tip it reached. Only what lies
   * between them is this tick's to digest.
   */
  span: { base: string; head: string },
): Promise<Unstamped<GateRevertAttempt>> {
  const diffStat = await capturedDiffStat(diffCwd, span);
  return {
    mode: "gate-revert",
    when,
    gate: failure.gate,
    message: failure.message,
    // Verbatim, unbounded like `message` beside it: a discriminant the chain
    // authored, not captured output (spec/chain.md "What a gate returns").
    ...(failure.verdict ? { verdict: failure.verdict } : {}),
    ...(failure.details
      ? {
          details: headTailBound(
            failure.details,
            MAX_PRIOR_DETAILS,
            MAX_PRIOR_DETAILS_TAIL,
          ),
        }
      : {}),
    diffStat,
    // Both copied verbatim, like `verdict` above: what the gate blamed and
    // whether it blamed the span at all are the gate's statements, and the
    // engine adds nothing to either (spec/chain.md "What a gate returns").
    // `blamesSpan` tests `=== false` because its one meaningful value is the
    // falsy one.
    ...(failure.failingFiles ? { failingFiles: failure.failingFiles } : {}),
    ...(failure.blamesSpan === false ? { blamesSpan: false as const } : {}),
  };
}

/**
 * Build the clean-exit record: the agent exited cleanly and left no usable
 * commit. What rides the record is the tail of its final message —
 * extracted from the full transcript by the adapter's own
 * `extractFinalMessage` (`src/claudeCode.ts`, spec/chain.md "The agent seam"),
 * unbound at that layer; `tailBound` here is record-size policy, not
 * provider shape, so it stays on this side of the seam. The message is
 * quoted, never classified: whether the exit was a refusal, a park, or
 * nothing to do is the chain's reading
 * (`.claude/rules/engine-boundary.md`, *Told, not inferred*).
 *
 * `span` is the attempt's own base and observed head, taken as a pair in the
 * record's own field names so the caller cannot transpose them. The two say
 * which of the mode's two exits happened — nothing committed, or a span
 * whose diff against its base was empty — which is why the no-message
 * fallback below states neither.
 */
export function buildCleanExit(
  finalMessage: string,
  span: Pick<CleanExitAttempt, "spanBase" | "spanHead">,
): Unstamped<CleanExitAttempt> {
  const message = tailBound(finalMessage, MAX_PRIOR_NOCOMMIT);
  return {
    mode: "clean-exit",
    ...span,
    finalMessage: message.length > 0 ? message : NO_FINAL_MESSAGE,
  };
}

/** Build the platform-preempt record from the non-work failure class. */
export function buildPlatformPreempt(
  failureClass: string,
): Unstamped<PlatformPreemptAttempt> {
  return {
    mode: "platform-preempt",
    failureClass: bound(failureClass, MAX_PRIOR_NOCOMMIT),
  };
}

/**
 * Build the render-refused record from the failure text of whatever refused
 * the render. Three writers reach it: a {@link MissingPlaceholderRenderError},
 * whose `message` names every `{{KEY}}` no arg filled, an
 * {@link InlineExecRenderError}, whose `message` already names every failing
 * span's command text and stderr, and a pre-invocation hook that threw
 * (`spec/chain.md`, *What a hook receives*), whose text names the hook and the
 * frame that raised. Text rather than the error itself because the three have
 * no error type in common — the first two share {@link RenderRefusal} and a
 * hook may throw any value at all.
 */
export function buildRenderRefused(
  failures: string,
): Unstamped<RenderRefusedAttempt> {
  return {
    mode: "render-refused",
    failures: bound(failures, MAX_PRIOR_NOCOMMIT),
  };
}

/**
 * Build the tip-moved record: the base the agent's private `flume/**` branch
 * started from is no longer an ancestor of the HEAD the agent left, so the
 * span was soft-reset away on that branch. That ancestry leg is the record's
 * only writer — a wave refusing to cherry-pick against a live foreign claim
 * reports `tipMoved` as a tick fact and writes nothing here, because it
 * discarded nothing. A sibling to the no-commit builders beside it, never a
 * `NoCommitMode` — see {@link TipMovedAttempt}.
 *
 * `observedTip` is always the observed HEAD itself, never its parent — both
 * legs run the same ancestry check now (spec/worktrees.md "Singleton runs in
 * a worktree" retired the singleton leg's own parent-equality check, whose
 * "found" used to name the mismatched commit's parent instead), so the
 * agent's own top commit always stays discoverable rather than reading as
 * the intruder.
 */
export function buildTipMoved(
  expectedTip: string,
  observedTip: string,
): Unstamped<TipMovedAttempt> {
  return { mode: "tip-moved", expectedTip, observedTip };
}

/**
 * Build the not-shipped record from the facts the engine already holds at the
 * ship decision — the cherry-picked sha, the paths that commit touched (the
 * same two the chain's own predicate was handed), and `threw`: the message
 * the predicate threw instead of returning, or `undefined` when it returned
 * `false` outright. Nothing about *why* the chain declined: the engine has no
 * such vocabulary (`.claude/rules/engine-boundary.md`, *Told, not
 * inferred*), and a predicate that ran returned a boolean, not a reason.
 * Whether it ran at all
 * is the engine's own fact, and the one the dispatcher already reports on the
 * tick's merge outcome — a record that dropped it would leave the retry and
 * every `shouldRun` reading a broken hook as a deliberate park.
 *
 * Bounded like every other variant (spec/loop.md "Bounded by construction —
 * a digest, not a transcript"): a wide commit's footprint is elided to
 * {@link MAX_PRIOR_TOUCHED_PATHS} entries with the omitted count stated,
 * never silently cut — a truncated list passing for a whole footprint is the
 * false signal the bound must not introduce — and a throw's message rides
 * the same {@link MAX_PRIOR_NOCOMMIT} head bound the other captured texts
 * do.
 */
export function buildNotShipped(
  mergedSha: string,
  touchedPaths: readonly string[],
  threw?: string,
): Unstamped<NotShippedAttempt> {
  const omitted = touchedPaths.length - MAX_PRIOR_TOUCHED_PATHS;
  return {
    mode: "not-shipped",
    mergedSha,
    touchedPaths: touchedPaths.slice(0, MAX_PRIOR_TOUCHED_PATHS),
    ...(omitted > 0 ? { omittedPaths: omitted } : {}),
    ...(threw === undefined ? {} : { threw: bound(threw, MAX_PRIOR_NOCOMMIT) }),
  };
}
