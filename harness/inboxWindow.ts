/**
 * The inbox slice's window (`spec/harness.md`, *The phases*): the queue's own
 * parse failure, the record queues, the declared friction channel, the build
 * refusals still standing against entries the queue carries, and the declared
 * CI lanes.
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
 * pickable and build re-parks into the same wall. The declared friction
 * channel is a third way in — the engine's own loop-to-owner channel, read
 * here as the record queues are (`friction.ts`) — and the lanes are the
 * fourth source, the only one whose evidence sits off this disk
 * (`ciLane.ts`).
 *
 * **The derive cursor is not among them, and not this slice's to move.** One
 * file per writer means no cursor has two hands on it, so a spec commit whose
 * derivation a drained record routed is still derive's to walk: the tick that
 * finds its sections already queued judges them done in its commit body and
 * moves the cursor itself — one cheap tick, paid for the property
 * (`spec/harness.md`, *Plan state as declared state*). This slice writes its
 * own state file and nothing else, which its fence holds
 * (`layout.ts`, `planArtifacts`).
 *
 * **One derivation per leg, two readers.** The wake set asks "is this slice
 * live"; the prompt asks "what is in it". Both answers come from the same
 * scan, so the slice cannot be woken over material its prompt then renders as
 * empty (`.claude/rules/engineering.md`, *Derived state is computed, never
 * restated beside its source*).
 */

import { readFileSync } from "node:fs";

import { namespacedJoin } from "../src/paths.js";
import { recordAttemptKey } from "../src/priorAttempts.js";
import type { PriorAttempt } from "../src/Prompt.js";

import { laneLeg } from "./ciLane.js";
import { INBOX_PHASE } from "./declaration.js";
import { frictionFiles, frictionPending } from "./friction.js";
import { RECORD_MAX_BYTES, recordFiles, recordsPending } from "./records.js";
import {
  SLICE_DATA_KEYS,
  budgetOf,
  queueResolved,
  type PlanSliceWindow,
  type PlanSliceWindowsOptions,
  type SliceArgs,
  type WindowContext,
} from "./sliceWindow.js";
import { standingRefusals } from "./standingRefusal.js";

/**
 * The inbox slice's window.
 *
 * **The parse-failure leg is asked first**, because it is the cheapest — a
 * field on the tick's own facts, no disk and no forge — and because over a
 * queue that did not resolve every sibling slice is shut behind the same
 * fact (`queueResolved`, `sliceWindow.ts`). This slice is the only one left
 * that can run, which is the point of it.
 *
 * **Every other leg is live on its own unrouted work** (`spec/harness.md`,
 * *The phases*). A waiting record, a note in the friction channel and a
 * standing refusal are each material only this slice routes, and none of
 * them is answered by shipping an entry — so what the queue happens to
 * carry decides none of them. The slice is a worker like every other: it
 * runs when the supervisor's budget has room, behind build in the declared
 * order, which is the same economics read at the sweep's queue
 * (`.claude/rules/posture-sweep.md`, *The sweep runs beside build, never
 * ahead of it*; `sweepWindow.ts`). A standing refusal makes that plainest —
 * it is keyed to an entry that is *still pickable*, so standing aside for
 * the queue would hand the baton straight back to the build wave that
 * already walled on it.
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
      recordsPending(inputs.flumeDir, inputs.claimed ?? []) ||
      frictionPending(inputs.flumeDir, friction) ||
      standingRefusals(options.stateRootRel, inputs.pending, inputs.priorAttempts)
        .length > 0 ||
      lanes.live(inputs.flumeDir),
    args: (ctx): SliceArgs<typeof INBOX_PHASE> => ({
      QUEUE_PARSE_FAILURE: renderQueueParseFailure(ctx),
      RECORDS: renderRecords(ctx.flumeDir, friction, ctx.claimed ?? []),
      BUILD_RECORDS: renderBuildRecords(options.stateRootRel, ctx),
      CI_LANES: lanes.render(ctx.flumeDir),
    }),
    dataKeys: SLICE_DATA_KEYS[INBOX_PHASE],
  };
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
 *
 * **A note or park whose entry a build tick holds is not among them.** The
 * listing withholds it (`recordFiles`, `records.ts`), so the drain is never
 * shown a file it would route away from the tick still writing it — and the
 * file stays on disk for the listing that follows the claim lifting
 * (`spec/pending.md`, *A claim covers the entry's records*). Withheld at the
 * listing rather than filtered here, because the liveness leg above asks the
 * same listing the same question and the two must not disagree.
 */
function renderRecords(
  flumeDir: string,
  friction: string | undefined,
  claimed: readonly string[],
): string {
  const blocks = [
    ...renderFiles(recordFiles(flumeDir, claimed), RECORD_MAX_BYTES),
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
function renderBuildRecords(stateRoot: string, ctx: WindowContext): string {
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
  const standing = new Set<PriorAttempt>(
    standingRefusals(stateRoot, ctx.pending, ctx.priorAttempts),
  );
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
