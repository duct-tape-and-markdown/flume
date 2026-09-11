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

import { existsSync } from "node:fs";
import type { Dirent } from "node:fs";
import { execFile } from "node:child_process";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, toNamespacedPath } from "node:path";
import { promisify } from "node:util";

import { bound, headTailBound, tailBound } from "./bounds.js";
import type { Logger } from "./Dispatcher.js";
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
 * the `headSha`/`at` anchor and the `key` keyspace — what each mode-specific
 * builder below actually produces. Kept as an explicit union (rather than a
 * distributed `Omit` over `PriorAttempt`) so each arm still carries its own
 * mode-specific fields rather than collapsing to their shared `mode` key.
 */
export type PriorAttemptDraft =
  | Omit<GateRevertAttempt, "headSha" | "at" | "key">
  | Omit<CleanExitAttempt, "headSha" | "at" | "key">
  | Omit<PlatformPreemptAttempt, "headSha" | "at" | "key">
  | Omit<RenderRefusedAttempt, "headSha" | "at" | "key">
  | Omit<TipMovedAttempt, "headSha" | "at" | "key">
  | Omit<NotShippedAttempt, "headSha" | "at" | "key">;

/**
 * Where one prior-attempt record lives and which keyspace that place belongs
 * to: `key` is the filename stem under `priorAttemptsDir` (an entry tag slug
 * or a phase name), `keyspace` the {@link PriorAttempt.key} value stamped
 * into the record written there. Produced only by
 * {@link priorAttemptRef}, so the two halves cannot disagree.
 */
export interface PriorAttemptRef {
  key: string;
  keyspace: PriorAttemptKeyspace;
}

/**
 * Prior-attempt records live beside the baton, under `priorAttemptsDir`
 * (`src/paths.ts`, which owns the name): gitignored harness runtime state
 * under the flume state dir, NOT in the per-entry worktree (a fanout retry
 * gets a fresh worktree; the record must outlive it). One JSON file per key —
 * the entry tag slug (fanout) or phase name (singleton).
 *
 * Re-exported here because that is where a chain reaches it from
 * (`src/index.ts`, `src/flumeApi.ts`).
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
 * Filesystem path of a tag's/phase's prior-attempt record
 * (spec/loop.md "Prior-outcome feedback to the retrying tick": "the exported
 * rule"). Slugifies internally — idempotent on an already-slugified key — so
 * a chain-authored `shouldRun` can derive the same path the dispatcher
 * itself reads and writes from nothing but the raw tag/phase name it already
 * has, with no private dispatcher rule to reverse-engineer.
 */
export function priorAttemptPath(flumeDir: string, tag: string): string {
  return join(priorAttemptsDir(flumeDir), `${slugify(tag)}.json`);
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
   * missing the `key` keyspace every record states (spec/loop.md "No false
   * signal") → treated as absent. `mode` alone does not make a
   * `PriorAttempt`: the renderer is exhaustive over the known modes and must
   * never be fed an unknown shape, and a chain comparing a record's `headSha` to the tip
   * reads a field the type promises is there. A record predating the anchor
   * is a stale slot, and a stale slot must never become a false signal.
   */
  async read(key: string): Promise<PriorAttempt | undefined> {
    const p = priorAttemptPath(this.flumeDir, key);
    if (!existsSync(toNamespacedPath(p))) return undefined;
    try {
      const rec = JSON.parse(await readFile(toNamespacedPath(p), "utf8")) as {
        mode?: unknown;
        headSha?: unknown;
        at?: unknown;
        key?: unknown;
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
        (rec.key === "entry" || rec.key === "phase")
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
   * keyed by the filename stem — exactly the key {@link read} would have
   * used to write it (`slugify` is idempotent on an already-slugified key,
   * so re-feeding the stem back through it resolves the same path). An
   * absent or unreadable directory reads as no records, the same "no prior"
   * degrade {@link read} already applies per file — the whole of
   * `TickContext.priorAttempts` (spec/chain.md "What a hook receives").
   */
  async readAll(): Promise<ReadonlyMap<string, PriorAttempt>> {
    const dir = priorAttemptsDir(this.flumeDir);
    let entries: Dirent[];
    try {
      entries = await readdir(toNamespacedPath(dir), { withFileTypes: true });
    } catch {
      return new Map();
    }
    const out = new Map<string, PriorAttempt>();
    for (const e of entries) {
      if (!e.isFile() || !e.name.endsWith(".json")) continue;
      const key = e.name.slice(0, -".json".length);
      const rec = await this.read(key);
      if (rec) out.set(key, rec);
    }
    return out;
  }

  /**
   * Stamps `headSha`/`at` (spec/loop.md "Every record is anchored") and the
   * writing ref's keyspace onto whatever mode-specific fields the caller
   * built, so every one of the `build*` functions below stays ignorant of
   * the anchor rather than each re-reading the trunk tip itself. `repoRoot`,
   * never `key`'s worktree — the anchor is the *trunk* tip regardless of
   * which worktree produced the record.
   */
  async write(ref: PriorAttemptRef, rec: PriorAttemptDraft): Promise<void> {
    const p = priorAttemptPath(this.flumeDir, ref.key);
    const anchored: PriorAttempt = {
      ...rec,
      key: ref.keyspace,
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
  async clear(key: string): Promise<void> {
    await rm(toNamespacedPath(priorAttemptPath(this.flumeDir, key)), {
      force: true,
    });
    await rm(toNamespacedPath(this.snapshotDir(key)), {
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
   * Keyed on the record's own `key` keyspace, never on the stem's text: a
   * phase's record is named by a phase name, which no queue ever carries,
   * so a stem-only test would clear the singleton records the queue has no
   * say over. Records that read as absent (corrupt, unanchored, no
   * keyspace) are not cleared — {@link readAll} never surfaces them, and
   * deleting a file this store cannot parse is a guess about what wrote it.
   */
  async clearStale(pending: readonly PendingEntry[]): Promise<string[]> {
    const queued = new Set(pending.map((e) => slugify(e.tag)));
    const records = await this.readAll();
    const stale = [...records]
      .filter(([key, rec]) => rec.key === "entry" && !queued.has(key))
      .map(([key]) => key)
      .sort();
    for (const key of stale) await this.clear(key);
    if (stale.length > 0) {
      this.log.info(
        `[flume] cleared ${stale.length} stale prior-attempt record(s): ${stale.join(", ")}`,
      );
    }
    return stale;
  }

  /**
   * Durable, gitignored snapshot dir for a gate-reverted commit's files.
   * Sibling to the prior-attempt JSON under `<flumeDir>/prior-attempts/`
   * (NOT the per-entry worktree) so it outlives both `git reset --hard` and
   * a fanout worktree teardown — the same durability that record relies on.
   */
  snapshotDir(key: string): string {
    return join(priorAttemptsDir(this.flumeDir), `${key}.reverted`);
  }

  /**
   * Snapshot every non-deleted file the reverted commit touched, verbatim,
   * into the durable snapshot dir before the hard reset destroys it.
   *
   * A gate-reverted plan tick otherwise loses its state.md /
   * open-questions.md prose to `git reset --hard`, recoverable only by a
   * human reading `.flume/sessions/` logs. The snapshot is post-image content
   * under a mirror of the repo path, so recovery is "open the file" — not
   * "read a diff", not "grep a session log". `diffStat` (the record's
   * digest) is `git show --stat`: filenames and counts, never content — it
   * cannot recover findings, which is why this distinct artifact exists.
   *
   * Generic by construction: it snapshots whatever the reverted commit
   * changed (for plan that is the prose plus the schema-failing
   * pending.json), so the dispatcher needs no chain-specific notion of which
   * artifact is "prose" vs "machine-checkable". Must run while `sha` is still
   * reachable (before the drop). Best-effort — a snapshot failure must never
   * block or fail the revert.
   */
  async snapshotReverted(cwd: string, sha: string, key: string): Promise<void> {
    const dir = this.snapshotDir(key);
    try {
      // The artifact tracks the *latest* reverted attempt only — drop any
      // stale snapshot from an earlier revert under this key first.
      await rm(toNamespacedPath(dir), { recursive: true, force: true });
      const { stdout } = await execFileP(
        "git",
        [
          "show",
          "--name-only",
          "--diff-filter=d",
          "--format=",
          "--no-color",
          sha,
        ],
        { cwd, maxBuffer: 16 * 1024 * 1024 },
      );
      const files = stdout
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean);
      for (const rel of files) {
        const { stdout: content } = await execFileP(
          "git",
          ["show", `${sha}:${rel}`],
          { cwd, maxBuffer: 16 * 1024 * 1024 },
        );
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
): Promise<Omit<GateRevertAttempt, "headSha" | "at" | "key">> {
  const diffStat = await capturedDiffStat(diffCwd, sha);
  return {
    mode: "gate-revert",
    when,
    gate: failure.gate,
    message: failure.message,
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
): Omit<CleanExitAttempt, "headSha" | "at" | "key"> {
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
): Omit<PlatformPreemptAttempt, "headSha" | "at" | "key"> {
  return {
    mode: "platform-preempt",
    failureClass: bound(failureClass, MAX_PRIOR_NOCOMMIT),
  };
}

/**
 * Build the render-refused record from the render's own
 * {@link InlineExecRenderError} — its `message` already names every failing
 * span's command text and stderr.
 */
export function buildRenderRefused(
  err: InlineExecRenderError,
): Omit<RenderRefusedAttempt, "headSha" | "at" | "key"> {
  return {
    mode: "render-refused",
    failures: bound(err.message, MAX_PRIOR_NOCOMMIT),
  };
}

/**
 * Build the tip-moved record: the ref this tick found didn't match the tip
 * it recorded at tick start. A sibling to the no-commit builders beside it,
 * never a `NoCommitMode` — see {@link TipMovedAttempt}.
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
): Omit<TipMovedAttempt, "headSha" | "at" | "key"> {
  return { mode: "tip-moved", expectedTip, observedTip };
}

/**
 * Build the not-shipped record from the facts the engine already holds at the
 * ship decision — the cherry-picked sha and the paths that commit touched,
 * the same two the chain's own predicate was handed. Nothing about *why* the
 * chain declined: the engine has no such vocabulary (`engine-boundary.md`,
 * *Told, not inferred*), and the predicate returned a boolean, not a reason.
 *
 * Bounded like every other variant (spec/loop.md "Bounded by construction"):
 * a wide commit's footprint is elided to {@link MAX_PRIOR_TOUCHED_PATHS}
 * entries with the omitted count stated, never silently cut — a truncated
 * list passing for a whole footprint is the false signal the bound must not
 * introduce.
 */
export function buildNotShipped(
  mergedSha: string,
  touchedPaths: readonly string[],
): Omit<NotShippedAttempt, "headSha" | "at" | "key"> {
  const omitted = touchedPaths.length - MAX_PRIOR_TOUCHED_PATHS;
  return {
    mode: "not-shipped",
    mergedSha,
    touchedPaths: touchedPaths.slice(0, MAX_PRIOR_TOUCHED_PATHS),
    ...(omitted > 0 ? { omittedPaths: omitted } : {}),
  };
}
