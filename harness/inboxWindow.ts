/**
 * The inbox slice's window (`spec/harness.md`, *The phases*): the queue's own
 * parse failure, the record queues, the declared friction channel, the build
 * refusals still standing against entries the queue carries, the declared CI
 * lanes, and the derive cursor this drain may advance through what it routed.
 *
 * **The parse failure comes first, and it is the one leg that is not a
 * findings source.** A queue that did not resolve leaves the whole loop with
 * nothing pickable and no slice able to derive over it, and the engine hands
 * the failure to exactly the phases whose fence admits the ledger
 * (`spec/pending.md`, *Queue reads are strict*). This slice is where that
 * lands: its window opens on the fact, its prompt renders it as the drain's
 * input, and its rewrite is the repair — which is what makes an unparseable
 * queue a tick to spend rather than a hand edit an operator has to learn
 * (`spec/harness.md`, *The gates the discipline needs*).
 *
 * The next two legs are there because there are two ways work reaches this
 * slice from inside the loop — someone left a file, or a build wave walled —
 * and either alone leaves a loop: without the record leg an operator's
 * finding is never read; without the refusal leg a parked entry stays
 * pickable, plan yields to build, and build re-parks into the same wall. The
 * declared friction channel is a third way in — the engine's own
 * loop-to-owner channel, read here as the record queues are
 * (`friction.ts`) — and the lanes are the fourth source, the only one whose
 * evidence sits off this disk (`ciLane.ts`). The derive cursor is no source
 * at all — nothing about it wakes this slice; it is what a drained record
 * lets this tick *close* (`spec/harness.md`, *Plan state as declared
 * state*).
 *
 * **A signal is not unrouted work.** Those disk legs read the same tree and
 * answer differently to a queue that still has work in it: the record and
 * friction legs yield to it, the refusal leg does not. Which is which is at
 * the predicate below.
 *
 * **One derivation per leg, two readers.** The ladder asks "is this slice
 * live"; the prompt asks "what is in it". Both answers come from the same
 * scan, so the slice cannot be woken over material its prompt then renders as
 * empty (`.claude/rules/engineering.md`, *Derived state is computed, never
 * restated beside its source*).
 */

import { readFileSync } from "node:fs";

import { namespacedJoin } from "../src/paths.js";
import { entryAttemptKey, recordAttemptKey } from "../src/priorAttempts.js";
import type { PriorAttempt } from "../src/Prompt.js";

import { laneLeg } from "./ciLane.js";
import { cursorRange } from "./cursorWindow.js";
import { INBOX_PHASE } from "./declaration.js";
import { frictionFiles, frictionPending } from "./friction.js";
import { touches } from "./gitRange.js";
import { PLAN_RESOLVES_MERGE, PLAN_RESOLVES_NO_COMMIT } from "./handoff.js";
import { RECORD_MAX_BYTES, recordFiles, recordsPending } from "./records.js";
import {
  SLICE_DATA_KEYS,
  budgetOf,
  queueResolved,
  type PlanSliceWindow,
  type PlanSliceWindowsOptions,
  type SliceArgs,
  type TickFacts,
  type WindowContext,
} from "./sliceWindow.js";

/**
 * The inbox slice's window.
 *
 * **The parse-failure leg yields to nothing.** It is asked first because it is
 * the cheapest — a field on the tick's own facts, no disk and no forge — and
 * because there is nothing for it to yield to: over a queue that did not
 * resolve the engine reports an empty `pending`, so nothing is pickable, and
 * every sibling slice is shut behind the same fact (`queueResolved`,
 * `sliceWindow.ts`). This slice is the only one left that can run, which is
 * the point of it.
 *
 * **The record leg yields to pickable work; the refusal leg does not**
 * (`spec/harness.md`, *The phases*). A waiting record is a signal, and while
 * the engine reports anything pickable the material it points at is behind
 * entries the queue can ship now — so the drain rides the next plan tick that
 * runs for its own reasons, which is the sweep's rule read at the other
 * queue (`.claude/rules/posture-sweep.md`, *The sweep yields to pickable
 * work*; `sweepWindow.ts`). A standing refusal is the opposite case by
 * construction: it is keyed to an entry that is *still pickable*, so yielding
 * to the queue hands the baton straight back to the build wave that already
 * walled on it.
 *
 * **The friction leg rides behind the record leg's yield**, because it is
 * the same kind of signal: a note the loop left for its owner points at
 * material the queue's own entries may already be shipping, and reading the
 * channel as the inbox is read means deferring it as the inbox's is
 * deferred (`spec/harness.md`, *Declared findings sources*).
 *
 * Deferring is not dropping. Only the liveness leg reads `pickable` — the
 * render below takes a `WindowContext`, which carries no such fact — so a
 * record the yield passed over is in the block the tick that does run is
 * handed, whichever slice woke it.
 *
 * **The lane leg is asked last, and that ordering is load-bearing.** The
 * record, friction and refusal legs are three directory listings and a map
 * walk; the lane leg spawns the forge CLI once per lane on the selection
 * path. A tick the disk already woke needs no forge answer to know the slice
 * runs, so the short-circuit is what keeps a woken plan tick from paying for
 * the network.
 */
export function inboxWindow(options: PlanSliceWindowsOptions): PlanSliceWindow {
  const lanes = laneLeg({
    lanes: options.declaration.ci,
    repoRoot: options.repoRoot,
    budget: budgetOf(options),
  });
  const friction = options.declaration.friction;
  return {
    name: INBOX_PHASE,
    live: (inputs) =>
      !queueResolved(inputs) ||
      (!inputs.pickable &&
        (recordsPending(inputs.flumeDir) ||
          frictionPending(inputs.flumeDir, friction))) ||
      standingRefusals(inputs).length > 0 ||
      lanes.live(inputs.flumeDir),
    args: (ctx): SliceArgs<typeof INBOX_PHASE> => ({
      QUEUE_PARSE_FAILURE: renderQueueParseFailure(ctx),
      RECORDS: renderRecords(ctx.flumeDir, friction),
      BUILD_RECORDS: renderBuildRecords(ctx),
      CI_LANES: lanes.render(ctx.flumeDir),
      DERIVE_CURSOR: renderDeriveCursor(ctx, options),
    }),
    dataKeys: SLICE_DATA_KEYS[INBOX_PHASE],
  };
}

/**
 * Which prior-attempt modes are standing refusals only a plan slice can
 * resolve.
 *
 * States no verdict of its own. "Can only plan resolve this" is one
 * question, and a record on disk is the same fate the tick reported, read a
 * run later — so every mode resolves through the table the build handoff
 * routes that same fate by: the four no-commit modes through
 * {@link PLAN_RESOLVES_NO_COMMIT}, and the two siblings that are merge fates
 * rather than `NoCommitMode` members through {@link PLAN_RESOLVES_MERGE},
 * which is where `TickResult` carries them (`entries[].mergeOutcome`). Both
 * rationales live at those tables (`.claude/rules/engineering.md`, *The fix
 * lands at the mechanism*).
 *
 * Exhaustive over `PriorAttempt["mode"]` by type, so a variant the engine
 * adds must be classified here rather than defaulting to "not a refusal" —
 * and each merge-fate key is indexed out of the engine's own `MergeOutcome`
 * table, so a fate that union drops is a type error rather than a verdict
 * this side goes on holding alone.
 */
const PLAN_RESOLVES_STANDING: Record<PriorAttempt["mode"], boolean> = {
  ...PLAN_RESOLVES_NO_COMMIT,
  "not-shipped": PLAN_RESOLVES_MERGE["not-shipped"],
  "tip-moved": PLAN_RESOLVES_MERGE["tip-moved"],
};

/**
 * The standing prior-attempt records that are refusals only a plan slice can
 * resolve **and** are keyed to an entry the queue still carries.
 *
 * Keyed to a live entry is the whole test: a record whose entry has left the
 * queue outlived the work it was about, and waking the inbox over it would
 * hold the slice open on nothing. So the walk runs the queue's way — each
 * queued entry looked up under the engine's own `entryAttemptKey`
 * (`src/priorAttempts.ts`), which is the key the store's walk filed the
 * record under. Reaching the record through that key rather than re-spelling
 * its two halves here is what keeps the keyspace and the tag's slug one
 * spelling: a slice that composed either itself would stop waking the day
 * the engine changed how it keys, silently, and over exactly the records a
 * wave is walling on (`.claude/rules/engineering.md`, *The fix lands at the
 * mechanism*). The keyspace comes with the key, which is what keeps a stem
 * the queue no longer carries from matching a live phase's record
 * (`spec/loop.md`, *No false signal*).
 *
 * The same set either way: the map holds one record per written identity, so
 * looking each queued entry up finds exactly the entry-keyspace records a
 * scan of the map's values would have kept.
 *
 * One derivation, two readers: the window's liveness leg above counts this,
 * and the rendered build-records block marks exactly these — by object
 * identity, since these are the map's own records.
 */
function standingRefusals(ctx: TickFacts): PriorAttempt[] {
  const attempts = ctx.priorAttempts;
  if (ctx.pending === undefined || attempts === undefined) return [];
  return ctx.pending
    .map((entry) => attempts.get(entryAttemptKey(entry)))
    .filter(
      (record): record is PriorAttempt =>
        record !== undefined && PLAN_RESOLVES_STANDING[record.mode],
    );
}

/**
 * The queue's parse failure as the drain's input, or the line that says the
 * queue resolved.
 *
 * The prompt already carries the queue's raw bytes, so what this block adds is
 * the *verdict on them*: which file did not resolve, and what the parse said.
 * Without it the tick is handed an empty queue and a file that looks like a
 * queue, with nothing to tell "nothing resolved" from "nothing is left"
 * (`.claude/rules/engineering.md`, *Loud or nothing*).
 *
 * The errors are rendered as the engine's own JSON, for the reason the
 * standing records below are: they are a bounded, engine-owned shape, and a
 * per-error sentence here would be a second vocabulary for fields this package
 * does not own, stranded by the first one the engine renames
 * (`.claude/rules/engineering.md`, *A fact the engine holds is reported, never
 * rediscovered*).
 *
 * The resolved case is **said, never rendered empty**: an empty block reads as
 * a queue with no errors in it, which is the same text a tick that failed to
 * render the fact would produce.
 */
function renderQueueParseFailure(ctx: WindowContext): string {
  const failure = ctx.queueParseFailure;
  if (failure === undefined) {
    return (
      "(the queue parsed; `<pending-now>` below is the queue this tick " +
      "rewrites, and it is empty only if it is drained.)"
    );
  }
  return [
    `=== ${failure.path} did not parse (${failure.errors.length} error(s)) ` +
      `— this tick was handed an empty queue because nothing resolved, not ` +
      `because the queue is drained ===`,
    JSON.stringify(failure.errors, null, 2),
  ].join("\n");
}

/**
 * Every waiting record's bytes, oldest first, each under the path it sits
 * at, with an over-cap record marked by what it measured — the record
 * queues first, then the declared friction channel.
 *
 * **The friction channel is read as the inbox is** (`spec/harness.md`,
 * *Declared findings sources*): one record per file, in the same block, so
 * a consumer routing what its loop left for its owner carries no prompt
 * paragraph of its own. It is a fourth findings source, not a fourth
 * *block* — a note the engine's revert path wrote and a note an operator
 * left in the inbox route by the same three outcomes, and splitting them
 * would be two vocabularies for one drain.
 *
 * Read whole rather than previewed: a record is written against
 * `RECORD_MAX_BYTES`, so the queue's whole content is the material and a
 * head of it would be a pointer at a file the slice would then have to open
 * anyway. Nothing upstream enforced that bound — the records gate reverts
 * only what protects the tree (`spec/harness.md`, *The gates the discipline
 * needs*) — so this render is where an overrun becomes visible, and the mark
 * is the drain's cue to name it in the plan commit body. Measured off the
 * bytes on disk, not the decoded string: the cap is bytes and a multi-byte
 * character is what the overrun is usually made of.
 *
 * **The cap rides the records alone.** It is the package's discipline over
 * what a *record* may weigh (`records.ts`), and a friction note is written
 * by the engine's revert path or by the consumer's own loop, neither of
 * which ever agreed to it — marking one would send the drain to name an
 * overrun against a bound nobody undertook.
 *
 * The path is rendered as its listing composed it and namespaced only for
 * the read, so what the tick is told to open is the path it can open
 * (`.claude/rules/platform-facts.md`, *Windows MAX_PATH (~260 chars) breaks
 * fs calls with no long component*).
 */
function renderRecords(flumeDir: string, friction: string | undefined): string {
  const blocks = [
    ...renderFiles(recordFiles(flumeDir), RECORD_MAX_BYTES),
    ...renderFiles(frictionFiles(flumeDir, friction), undefined),
  ];
  if (blocks.length === 0) return "(no records)";
  return blocks.join("\n\n");
}

/**
 * One block per file: the path it sits at, the cap mark where `cap` is a
 * bound this file was written against and its bytes exceed it, then the
 * bytes whole.
 *
 * `cap` is `undefined` for a queue that carries no byte bound, which is what
 * keeps the mark a statement about the file rather than about the renderer
 * (`.claude/rules/engineering.md`, *The fix lands at the mechanism*: the two
 * queues differ in the bound they were written under, and in nothing else
 * this block says).
 */
function renderFiles(
  files: readonly string[],
  cap: number | undefined,
): string[] {
  return files.map((file) => {
    const bytes = readFileSync(namespacedJoin(file));
    const mark =
      cap !== undefined && bytes.byteLength > cap
        ? ` (${bytes.byteLength} bytes, cap ${cap} — name this overrun in the commit body)`
        : "";
    return `--- ${file}${mark} ---\n${bytes.toString("utf8").trimEnd()}`;
  });
}

/**
 * The standing prior-attempt records, verbatim, with the ones keyed to an
 * entry the queue still carries marked as the slice's own work.
 *
 * Rendered as the engine's own JSON rather than paraphrased per mode: the
 * records are bounded by construction — a digest, not a transcript — and a
 * per-mode renderer here would be a second vocabulary for the engine's own
 * fields, stranded by the first field it renames
 * (`.claude/rules/engineering.md`, *A fact the engine holds is reported,
 * never rediscovered*).
 *
 * Every record is shown, not only the marked ones: a record keyed to a phase
 * or to an entry that has left the queue is context for what the loop has
 * been doing, and the mark is what says which ones this tick must resolve.
 */
function renderBuildRecords(ctx: WindowContext): string {
  // Ordered by each record's own key, asked of the engine rather than joined
  // from the record's two halves here: how the engine composes that key is
  // the engine's, and a slice spelling the join itself would order by a
  // second vocabulary the day the engine changed its first
  // (`.claude/rules/engineering.md`, *A fact the engine holds is reported,
  // never rediscovered*). Read off the values rather than the map's own keys
  // for the reason the mark below is by identity: the record is what this
  // block renders, and every fact about it comes off the record.
  const records = [
    ...(ctx.priorAttempts ?? new Map<string, PriorAttempt>()).values(),
  ].sort((a, b) => {
    const left = recordAttemptKey(a);
    const right = recordAttemptKey(b);
    return left < right ? -1 : left > right ? 1 : 0;
  });
  if (records.length === 0) return "(no standing prior-attempt records)";

  // By reference: `standingRefusals` filters the same record objects this
  // list holds, so identity is the marking test and no second key spelling
  // can drift from it.
  const standing = new Set<PriorAttempt>(standingRefusals(ctx));
  const lines = [`=== ${records.length} standing prior-attempt record(s) ===`];
  for (const record of records) {
    const mark = standing.has(record)
      ? " ← the queue still carries this entry; reconcile it"
      : "";
    lines.push(`--- ${record.keyedAs} (${record.key} keyspace)${mark} ---`);
    lines.push(JSON.stringify(record, null, 2));
  }
  return lines.join("\n");
}

/**
 * The derive cursor and the spec-locus commits standing past it, oldest
 * first — the shas this drain may advance `derivedThrough` through, and
 * nothing else.
 *
 * **Named here, never rediscovered by the tick.** A record that routes a
 * spec commit's derivation leaves that commit derived, and a drain told only
 * "advance the cursor" would resolve a sha itself and stamp over whatever
 * landed while it worked. The candidates are listed instead, so the advance
 * is a choice among facts the window already read — the same discipline the
 * bootstrap tip and the derive window's `may advance to` line carry
 * (`.claude/rules/posture-sweep.md`, *The stamp*). Which of them a record
 * actually claimed is the drain's judgement, and the prompt bounds it to a
 * leading run.
 *
 * Listed without their diffs: this slice does not derive them. The drain
 * reads a commit here only to recognise the one its routed record was about,
 * and rendering the patches would be the derive window's material in a slice
 * that will not read it.
 *
 * **Absent when nothing consults the cursor.** A consumer that did not
 * enable the derive slice has a `derivedThrough` no window is drawn past, so
 * there is no tick to save and no listing worth a `git log` per drain —
 * said, rather than rendered empty, since an empty listing reads as a quiet
 * tree.
 */
function renderDeriveCursor(
  ctx: WindowContext,
  options: PlanSliceWindowsOptions,
): string {
  if (!options.declaration.slices.enabled.includes("plan-derive")) {
    return (
      "(the derive slice is not enabled here, so `derivedThrough` is a " +
      "cursor no window is drawn past; advance nothing.)"
    );
  }
  const locus = options.declaration.specLocus;
  return cursorRange("derivedThrough", ctx, {
    absent: () =>
      "(no plan state yet, so there is no `derivedThrough` to advance; the " +
      "derive slice stamps the first one. Advance nothing.)",
    render: (cursor, all) => {
      const inLocus = all.filter((commit) => touches(commit, locus));
      const lines = [
        `=== \`derivedThrough\` is at ${cursor}; ${inLocus.length} spec-locus ` +
          `commit(s) stand past it, oldest first ===`,
      ];
      if (inLocus.length === 0) {
        lines.push("(nothing past the cursor; advance nothing.)");
        return lines.join("\n");
      }
      lines.push(...inLocus.map((commit) => `${commit.sha} ${commit.subject}`));
      return lines.join("\n");
    },
  });
}
