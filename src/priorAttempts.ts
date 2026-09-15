/**
 * priorAttempts — the prior-attempt record's own home: where a record lives,
 * how it is read, written, cleared and swept, the durable snapshot of a
 * gate-reverted commit's files, and the per-mode builders that mint each
 * variant.
 *
 * Split out of `src/Dispatcher.ts` (`.claude/rules/posture-sweep.md`, "A
 * violation counts only when verified on disk this tick"): persistence of
 * the retry's input is a job of its own — one directory, one file shape, one
 * keyspace rule — and it depends on nothing the dispatcher holds beyond the
 * three values {@link PriorAttemptStore} is constructed with. The dependency
 * runs one way: the dispatcher calls in here, nothing here calls back.
 *
 * spec/loop.md "Prior-outcome feedback to the retrying tick" is the contract
 * every shape below serves — a record is anchored, keyspaced, bounded, and
 * never a false signal.
 */

import type { Dirent } from "node:fs";
import { execFile } from "node:child_process";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, toNamespacedPath } from "node:path";
import { promisify } from "node:util";

import { bound, headTailBound, tailBound } from "./bounds.js";
import type { Logger } from "./Dispatcher.js";
import { existsLoud } from "./fsProbe.js";
import * as git from "./git.js";
import { priorAttemptsDir, slugify } from "./paths.js";
import type { PendingEntry } from "./PendingSchema.js";
import type { Phase } from "./Phase.js";
import type { InlineExecRenderError } from "./Prompt.js";
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

const execFileP = promisify(execFile);

/**
 * A `PriorAttempt` variant before {@link PriorAttemptStore.write} stamps
 * the `headSha`/`at` anchor, the `key` keyspace and the `keyedAs` written
 * identity — what each mode-specific builder below actually produces. Kept as an explicit union (rather than a
 * distributed `Omit` over `PriorAttempt`) so each arm still carries its own
 * mode-specific fields rather than collapsing to their shared `mode` key.
 */
export type PriorAttemptDraft =
  | Omit<GateRevertAttempt, "headSha" | "at" | "key" | "keyedAs">
  | Omit<CleanExitAttempt, "headSha" | "at" | "key" | "keyedAs">
  | Omit<PlatformPreemptAttempt, "headSha" | "at" | "key" | "keyedAs">
  | Omit<RenderRefusedAttempt, "headSha" | "at" | "key" | "keyedAs">
  | Omit<TipMovedAttempt, "headSha" | "at" | "key" | "keyedAs">
  | Omit<NotShippedAttempt, "headSha" | "at" | "key" | "keyedAs">;

/**
 * Where one prior-attempt record lives and which keyspace that place belongs
 * to: `key` is the identity the record is written under — an entry tag slug
 * or a phase name exactly as the chain spells it, which
 * {@link priorAttemptStem} slugifies into the filename stem and
 * {@link PriorAttemptStore.write} stamps verbatim onto the record's
 * {@link PriorAttempt.keyedAs}; `keyspace` is the {@link PriorAttempt.key}
 * value stamped alongside it. Produced only by {@link priorAttemptRef}, so
 * the halves cannot disagree.
 */
export interface PriorAttemptRef {
  key: string;
  keyspace: PriorAttemptKeyspace;
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
 * The ref a persisted record was written under, read back off the record's
 * own stamped fields — the inverse of what {@link PriorAttemptStore.write}
 * stamps. `clearStale` re-derives the path of a record it enumerated this
 * way rather than from the filename it found it at, so the identity that
 * keys the map is the identity that keys the removal.
 */
function refOfRecord(rec: PriorAttempt): PriorAttemptRef {
  return { key: rec.keyedAs, keyspace: rec.key };
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
 * Bound on the persisted clean-exit constraint / platform-preempt
 * failure class. Same telegraphic discipline as the gate digest: enough to
 * name the wall, not the transcript.
 */
const MAX_PRIOR_NOCOMMIT = 4 * 1024;
/**
 * Bound on the persisted not-shipped record's path list. A footprint, like a
 * diffstat, names what landed — a few hundred lines is already past what the
 * retry reads, and the record renders straight into a prompt.
 */
const MAX_PRIOR_TOUCHED_PATHS = 200;

/**
 * spec/chain.md "What a gate returns": a gate-revert record earns
 * `suspectFlake: true` only when the gate named `failingFiles` AND every
 * named file is disjoint from the reverted span's own footprint — the
 * entry's own edits cannot have caused a failure in files it never touched.
 * Mechanical, from list disjointness alone; never inferred from gate prose,
 * and never derived from an absent or empty `failingFiles` (non-vacuous:
 * nothing named means nothing to disjoint-check).
 */
function isSuspectFlake(
  failingFiles: string[] | undefined,
  footprint: string[],
): boolean {
  if (!failingFiles || failingFiles.length === 0) return false;
  const touched = new Set(footprint);
  return failingFiles.every((f) => !touched.has(f));
}

/**
 * Where a phase/entry's prior-attempt record lives: the entry tag slug for
 * fanout, the phase name for singleton. A retry is scheduled "for that
 * same entry (fanout) or phase (singleton)" — the key mirrors exactly that
 * scope so the next tick reads its own predecessor.
 *
 * Key and keyspace are derived here together and travel as one value:
 * which keyspace a stem belongs to is not recoverable from its text, and
 * a pair threaded as two parameters is a pair a callsite can mismatch.
 */
export function priorAttemptRef(
  phase: Phase,
  entry?: PendingEntry,
): PriorAttemptRef {
  return entry
    ? { key: slugify(entry.tag), keyspace: "entry" }
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
   * Read a persisted prior-attempt record, if any. Corrupt, carrying an
   * unrecognized `mode` discriminant, missing the `headSha`/`at` anchor
   * every record carries (spec/loop.md "Every record is anchored"), or
   * missing the `key` keyspace / `keyedAs` written identity every record
   * states (spec/loop.md "No false signal") → treated as absent. `mode` alone does not make a
   * `PriorAttempt`: the renderer is exhaustive over the known modes and must
   * never be fed an unknown shape, and a chain comparing a record's `headSha` to the tip
   * reads a field the type promises is there. A record predating the anchor
   * is a stale slot, and a stale slot must never become a false signal —
   * and one predating `keyedAs` has no identity to key {@link readAll}'s map
   * by, which would put it in a chain's hands under `undefined`.
   *
   * A record whose stated keyspace disagrees with the directory it was found
   * in is the same class of undecodable: the two sides of its identity
   * contradict each other, and honouring the stated one would file it in the
   * map under a key whose path — the one {@link clear} would later remove —
   * is not the file it came from.
   */
  async read(ref: PriorAttemptRef): Promise<PriorAttempt | undefined> {
    const p = priorAttemptPath(this.flumeDir, ref);
    // Absent is the only silent reading: `existsLoud` (src/fsProbe.ts) throws
    // on a record that is present but unstattable. "No prior attempt" is the
    // signal spec/loop.md "Repeated identical failures" counts on, so a
    // record the probe cannot reach must refuse rather than reset that count
    // — the degradations below are for a record that was *read* and found
    // garbled, never for one that was never reached.
    if (!existsLoud(toNamespacedPath(p))) return undefined;
    try {
      const rec = JSON.parse(await readFile(toNamespacedPath(p), "utf8")) as {
        mode?: unknown;
        headSha?: unknown;
        at?: unknown;
        key?: unknown;
        keyedAs?: unknown;
      };
      if (
        rec &&
        (rec.mode === "gate-revert" ||
          rec.mode === "clean-exit" ||
          rec.mode === "platform-preempt" ||
          rec.mode === "render-refused" ||
          rec.mode === "tip-moved" ||
          rec.mode === "not-shipped") &&
        typeof rec.headSha === "string" &&
        typeof rec.at === "string" &&
        isKeyspace(rec.key) &&
        rec.key === ref.keyspace &&
        typeof rec.keyedAs === "string" &&
        rec.keyedAs.length > 0
      ) {
        return rec as PriorAttempt;
      }
      return undefined;
    } catch {
      // A garbled record must not crash the tick — degrade to "no prior".
      return undefined;
    }
  }

  /**
   * Every persisted prior-attempt record under `<flumeDir>/prior-attempts/`,
   * keyed by the keyspace and the identity each record was **written** under
   * — `entry:<tag slug>`, `phase:<phase name>`
   * ({@link priorAttemptMapKey}) — not by the filename stem it happens to
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
   * Absent (`ENOENT`) is the only silent reading: nothing written is no
   * records. A directory that is present but cannot be enumerated — a plain
   * file sitting at the path (`ENOTDIR`), permission denied, a path too long
   * for the platform — escapes, the same ENOENT-vs-other split
   * `countFrictionFiles` (src/job.ts) gives a friction dir. This map feeds
   * every `TickContext.priorAttempts` a tick's hooks read, so an unreachable
   * directory reported as an empty map tells every `shouldRun` "no prior
   * attempt" and silently resets the repeated-failure count spec/loop.md
   * "Repeated identical failures" keeps — the same refusal {@link read}
   * makes per file, where the degrade to "no prior" is only ever for a
   * record that was *read* and found garbled.
   */
  async readAll(): Promise<ReadonlyMap<string, PriorAttempt>> {
    const out = new Map<string, PriorAttempt>();
    for (const keyspace of KEYSPACE_NAMES) {
      const dir = join(priorAttemptsDir(this.flumeDir), keyspace);
      let entries: Dirent[];
      try {
        entries = await readdir(toNamespacedPath(dir), { withFileTypes: true });
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw err;
      }
      for (const e of entries) {
        if (!e.isFile() || !e.name.endsWith(".json")) continue;
        const stem = e.name.slice(0, -".json".length);
        const rec = await this.read({ key: stem, keyspace });
        if (rec) out.set(priorAttemptMapKey(refOfRecord(rec)), rec);
      }
    }
    return out;
  }

  /**
   * Stamps `headSha`/`at` (spec/loop.md "Every record is anchored") and the
   * writing ref's keyspace and key onto whatever mode-specific fields the
   * caller built, so every one of the `build*` functions below stays ignorant of
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
   * record. Records that read as absent (corrupt, unanchored, no keyspace)
   * are not cleared — {@link readAll} never surfaces them, and deleting a
   * file this store cannot parse is a guess about what wrote it.
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
   * Snapshot every non-deleted file the reverted commit touched, verbatim,
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
   * Generic by construction: it snapshots whatever the reverted commit
   * changed, so the dispatcher needs no chain-specific notion of which
   * artifact is "prose" vs "machine-checkable", and names no chain's file.
   * Must run while `sha` is still reachable (before the drop). Best-effort —
   * a snapshot failure must never block or fail the revert.
   */
  async snapshotReverted(
    cwd: string,
    sha: string,
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
      // still resolves as `<sha>:<path>`; the content through the shared
      // tip-read.
      const files = await git.showNameOnly(cwd, sha, { excludeDeleted: true });
      for (const rel of files) {
        // `excludeDeleted` already dropped everything this commit removed, so
        // a null here means the listing and the tree disagree at one sha —
        // skip that path rather than abandoning the rest of the snapshot to
        // the catch below, which is the whole artifact for the sake of one
        // file.
        const content = await git.readFileAtRef(cwd, sha, rel);
        if (content === null) continue;
        const dest = join(dir, rel);
        // win32 MAX_PATH (`.claude/rules/platform-facts.md`): dest depth
        // here is driven by the reverted diff's own path depth, not
        // chain.friction, but it's the same join(dir, rel) unwrapped shape
        // writeRevertNote/harvestFriction guard use — same idiom.
        await mkdir(toNamespacedPath(dirname(dest)), { recursive: true });
        await writeFile(toNamespacedPath(dest), content, "utf8");
      }
    } catch {
      // Recovery is best-effort by spec; never block or fail the revert path.
    }
  }
}

/**
 * Bounded `git show --stat` of the reverted commit — the prior-attempt
 * digest, so the retry does not blindly reconstruct. Must be called while
 * `sha` is still reachable (before the hard reset / commit drop).
 * Best-effort: a failure here must not block the revert path.
 */
async function capturedDiffStat(cwd: string, sha: string): Promise<string> {
  try {
    const { stdout } = await execFileP(
      "git",
      ["show", "--stat", "--oneline", "--no-color", sha],
      { cwd, maxBuffer: 4 * 1024 * 1024 },
    );
    return bound(stdout.trimEnd(), MAX_PRIOR_DIFFSTAT);
  } catch {
    return "(diff stat unavailable)";
  }
}

/**
 * Build the gate-revert record: an afterCommit/afterMerge gate refused the
 * span and the engine dropped it. Carries the gate's own verdict plus the
 * bounded `git show --stat` of what was reverted, so the retry reads what
 * landed instead of blindly reconstructing it.
 */
export async function buildGateRevert(
  when: GateRevertAttempt["when"],
  failure: {
    gate: string;
    message: string;
    verdict?: string;
    details?: string;
    failingFiles?: string[];
  },
  diffCwd: string,
  sha: string,
  /**
   * The reverted span's own touched paths (spec/chain.md "What a gate
   * returns") — the footprint `suspectFlake` disjointness reads against.
   */
  footprint: string[],
): Promise<Omit<GateRevertAttempt, "headSha" | "at" | "key" | "keyedAs">> {
  const diffStat = await capturedDiffStat(diffCwd, sha);
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
    ...(isSuspectFlake(failure.failingFiles, footprint)
      ? { suspectFlake: true }
      : {}),
  };
}

/**
 * Build the clean-exit record: the agent exited cleanly without
 * committing. What rides the record is the tail of its final message —
 * extracted from the full transcript by the adapter's own
 * `extractFinalMessage` (`src/Agent.ts`, spec/chain.md "The agent seam"),
 * unbound at that layer; `tailBound` here is record-size policy, not
 * provider shape, so it stays on this side of the seam. The message is
 * quoted, never classified: whether the exit was a refusal, a park, or
 * nothing to do is the chain's reading (`engine-boundary.md`, *Told, not
 * inferred*).
 */
export function buildCleanExit(
  finalMessage: string,
): Omit<CleanExitAttempt, "headSha" | "at" | "key" | "keyedAs"> {
  const message = tailBound(finalMessage, MAX_PRIOR_NOCOMMIT);
  return {
    mode: "clean-exit",
    finalMessage:
      message.length > 0
        ? message
        : "(agent exited cleanly without committing and produced no final message)",
  };
}

/** Build the platform-preempt record from the non-work failure class. */
export function buildPlatformPreempt(
  failureClass: string,
): Omit<PlatformPreemptAttempt, "headSha" | "at" | "key" | "keyedAs"> {
  return {
    mode: "platform-preempt",
    failureClass: bound(failureClass, MAX_PRIOR_NOCOMMIT),
  };
}

/**
 * Build the render-refused record from the failure text of whatever refused
 * the render. Two writers reach it: an {@link InlineExecRenderError}, whose
 * `message` already names every failing span's command text and stderr, and a
 * pre-invocation hook that threw (`spec/chain.md`, *What a hook receives*),
 * whose text names the hook and the frame that raised. Text rather than the
 * error itself because the two have no error type in common — a hook may
 * throw any value at all.
 */
export function buildRenderRefused(
  failures: string,
): Omit<RenderRefusedAttempt, "headSha" | "at" | "key" | "keyedAs"> {
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
): Omit<TipMovedAttempt, "headSha" | "at" | "key" | "keyedAs"> {
  return { mode: "tip-moved", expectedTip, observedTip };
}

/**
 * Build the not-shipped record from the facts the engine already holds at the
 * ship decision — the cherry-picked sha, the paths that commit touched (the
 * same two the chain's own predicate was handed), and `threw`: the message
 * the predicate threw instead of returning, or `undefined` when it returned
 * `false` outright. Nothing about *why* the chain declined: the engine has no
 * such vocabulary (`engine-boundary.md`, *Told, not inferred*), and a
 * predicate that ran returned a boolean, not a reason. Whether it ran at all
 * is the engine's own fact, and the one the dispatcher already reports on the
 * tick's merge outcome — a record that dropped it would leave the retry and
 * every `shouldRun` reading a broken hook as a deliberate park.
 *
 * Bounded like every other variant (spec/loop.md "Bounded by construction"):
 * a wide commit's footprint is elided to {@link MAX_PRIOR_TOUCHED_PATHS}
 * entries with the omitted count stated, never silently cut — a truncated
 * list passing for a whole footprint is the false signal the bound must not
 * introduce — and a throw's message rides the same
 * {@link MAX_PRIOR_NOCOMMIT} head bound the other captured texts do.
 */
export function buildNotShipped(
  mergedSha: string,
  touchedPaths: readonly string[],
  threw?: string,
): Omit<NotShippedAttempt, "headSha" | "at" | "key" | "keyedAs"> {
  const omitted = touchedPaths.length - MAX_PRIOR_TOUCHED_PATHS;
  return {
    mode: "not-shipped",
    mergedSha,
    touchedPaths: touchedPaths.slice(0, MAX_PRIOR_TOUCHED_PATHS),
    ...(omitted > 0 ? { omittedPaths: omitted } : {}),
    ...(threw === undefined ? {} : { threw: bound(threw, MAX_PRIOR_NOCOMMIT) }),
  };
}
