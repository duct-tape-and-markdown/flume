/**
 * The inbox slice's window (`spec/harness.md`, *The phases*): the record
 * queues, the build refusals still standing against entries the queue
 * carries, the declared CI lanes, and the derive cursor this drain may
 * advance through what it routed.
 *
 * The first two legs are there because there are two ways work reaches this
 * slice from inside the loop — someone left a file, or a build wave walled —
 * and either alone leaves a loop: without the record leg an operator's
 * finding is never read; without the refusal leg a parked entry stays
 * pickable, plan yields to build, and build re-parks into the same wall. The
 * lanes are the third source, and the only one whose evidence sits off this
 * disk (`ciLane.ts`). The derive cursor is no source at all — nothing about
 * it wakes this slice; it is what a drained record lets this tick *close*
 * (`spec/harness.md`, *Plan state as declared state*).
 *
 * **A signal is not unrouted work.** Those two legs read the same disk and
 * answer differently to a queue that still has work in it: the record leg
 * yields to it, the refusal leg does not. Which is which is at the predicate
 * below.
 *
 * **One derivation per leg, two readers.** The ladder asks "is this slice
 * live"; the prompt asks "what is in it". Both answers come from the same
 * scan, so the slice cannot be woken over material its prompt then renders as
 * empty (`.claude/rules/engineering.md`, *Derived state is computed, never
 * restated beside its source*).
 */

import { readFileSync } from "node:fs";

import { namespacedJoin, slugify } from "../src/paths.js";
import type { PriorAttempt } from "../src/Prompt.js";

import { laneLeg } from "./ciLane.js";
import { cursorRange } from "./cursorWindow.js";
import { INBOX_PHASE } from "./declaration.js";
import { touches } from "./gitRange.js";
import { PLAN_RESOLVES_MERGE, PLAN_RESOLVES_NO_COMMIT } from "./handoff.js";
import { RECORD_MAX_BYTES, recordFiles, recordsPending } from "./records.js";
import {
  SLICE_DATA_KEYS,
  budgetOf,
  type PlanSliceWindow,
  type PlanSliceWindowsOptions,
  type SliceArgs,
  type TickFacts,
  type WindowContext,
} from "./sliceWindow.js";

/**
 * The inbox slice's window.
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
 * Deferring is not dropping. Only the liveness leg reads `pickable` — the
 * render below takes a `WindowContext`, which carries no such fact — so a
 * record the yield passed over is in the block the tick that does run is
 * handed, whichever slice woke it.
 *
 * **The lane leg is asked last, and that ordering is load-bearing.** The
 * record and refusal legs are two directory listings and a map walk; the lane
 * leg spawns the forge CLI once per lane on the selection path. A tick the
 * disk already woke needs no forge answer to know the slice runs, so the
 * short-circuit is what keeps a woken plan tick from paying for the network.
 */
export function inboxWindow(options: PlanSliceWindowsOptions): PlanSliceWindow {
  const lanes = laneLeg({
    lanes: options.declaration.ci,
    repoRoot: options.repoRoot,
    budget: budgetOf(options),
  });
  return {
    name: INBOX_PHASE,
    live: (inputs) =>
      (!inputs.pickable && recordsPending(inputs.flumeDir)) ||
      standingRefusals(inputs).length > 0 ||
      lanes.live(inputs.flumeDir),
    args: (ctx): SliceArgs<typeof INBOX_PHASE> => ({
      RECORDS: renderRecords(ctx.flumeDir),
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
 * hold the slice open on nothing. The keyspace is the record's own stated
 * `key` field rather than a guess from the key's text — a stem the queue no
 * longer carries is a retired tag in one keyspace and a live phase in the
 * other (`spec/loop.md`, *No false signal*) — and the queue side is
 * slugified with the engine's own `slugify`, which is what wrote the key.
 *
 * One derivation, two readers: the window's liveness leg above counts this,
 * and the rendered build-records block marks exactly these.
 */
function standingRefusals(ctx: TickFacts): PriorAttempt[] {
  if (ctx.pending === undefined || ctx.priorAttempts === undefined) return [];
  const queued = new Set(ctx.pending.map((entry) => slugify(entry.tag)));
  return [...ctx.priorAttempts.values()].filter(
    (record) =>
      record.key === "entry" &&
      queued.has(record.keyedAs) &&
      PLAN_RESOLVES_STANDING[record.mode],
  );
}

/**
 * Every waiting record's bytes, oldest first, each under the path it sits
 * at, with an over-cap record marked by what it measured.
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
 * The path is rendered as `recordFiles` composed it and namespaced only for
 * the read, so what the tick is told to open is the path it can open
 * (`.claude/rules/platform-facts.md`, *Windows MAX_PATH (~260 chars) breaks
 * fs calls with no long component*).
 */
function renderRecords(flumeDir: string): string {
  const files = recordFiles(flumeDir);
  if (files.length === 0) return "(no records)";
  return files
    .map((file) => {
      const bytes = readFileSync(namespacedJoin(file));
      const mark =
        bytes.byteLength > RECORD_MAX_BYTES
          ? ` (${bytes.byteLength} bytes, cap ${RECORD_MAX_BYTES} — name this overrun in the commit body)`
          : "";
      return `--- ${file}${mark} ---\n${bytes.toString("utf8").trimEnd()}`;
    })
    .join("\n\n");
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
  // Read off the map's values and each record's own stated identity, never
  // off the map key: how the engine composes that key is the engine's, and a
  // slice that re-spelled it here would mark the wrong records the day it
  // changed (`.claude/rules/engineering.md`, *A fact the engine holds is
  // reported, never rediscovered*).
  const records = [
    ...(ctx.priorAttempts ?? new Map<string, PriorAttempt>()).values(),
  ].sort((a, b) => {
    const left = `${a.key}:${a.keyedAs}`;
    const right = `${b.key}:${b.keyedAs}`;
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
