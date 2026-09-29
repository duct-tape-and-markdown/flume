/**
 * Where an entry a plan slice files sits in the queue's one ordering
 * (`spec/harness.md`, *The phases*) — the numbers themselves, as the one
 * value the slice prompt that states a band and the gate that holds a slice
 * to it both read.
 *
 * **A band is a fact about provenance**, so it is keyed on the source the
 * work came from and then gathered per slice: which sources a slice can file
 * from is decided by which queues it drains, and the pairing is what a
 * refusal has to name. The engine consumes the number and nothing about what
 * it means (`.claude/rules/engine-boundary.md`, *Capability vs convention*),
 * which is why the reading lives here in the package rather than beside the
 * schema that types it.
 *
 * One home, because a number spelled at each reader is a number the next
 * reader disagrees with: a prompt stating `10` while a gate admits `20`
 * refuses exactly the entry it asked for (`.claude/rules/engineering.md`,
 * *Derived state is computed, never restated beside its source*).
 */

import type { PlanSlice } from "./declaration.js";

/**
 * The band each source of work files at — the whole ordering the package has
 * an opinion about, named by where the work came from rather than by which
 * slice routed it (`spec/harness.md`, *The phases*).
 */
export const FILING_BANDS = {
  /**
   * A downstream report, an operator's ruling, a declared friction note, or
   * a failing title a CI lane reported: something outside the loop is
   * waiting on it.
   */
  report: 30,
  /** A build note the drain routed into an entry. */
  note: 20,
  /** Derived against a spec commit the derive cursor had not reached. */
  spec: 10,
  /** The sweep's insurance, served behind every product band. */
  sweep: 0,
} as const;

/**
 * Every band a slice's own filed entries may carry, in the order that slice's
 * prompt states them.
 *
 * Keyed exhaustively by {@link PlanSlice}, so a fourth slice joins the gate
 * and the prompt by joining this table rather than by being missed by both.
 * The inbox slice carries two because it drains two kinds of queue, and which
 * kind a record is, is its directory.
 *
 * Reached through the two verdicts below rather than handed out: a caller
 * wants to know whether a rank is in band or how to name the band, and a
 * third reader of the listing itself is a second place the membership rule
 * could be spelled.
 */
const SLICE_FILING_BANDS: Record<PlanSlice, readonly number[]> = {
  "plan-inbox": [FILING_BANDS.report, FILING_BANDS.note],
  "plan-derive": [FILING_BANDS.spec],
  "plan-sweep": [FILING_BANDS.sweep],
};

/**
 * Whether a rank is one this slice's band admits — the whole verdict the
 * filing-band gate makes over an entry the slice added.
 */
export function inFilingBand(slice: PlanSlice, priority: number): boolean {
  return SLICE_FILING_BANDS[slice].includes(priority);
}

/**
 * The slice's band as a message names it — `` `30` or `20` ``, in the table's
 * own order.
 *
 * Spelled here rather than at the gate, so the numbers a refusal hands back
 * and the numbers a prompt asked for come off one table in one alphabet.
 */
export function spelledBand(slice: PlanSlice): string {
  return SLICE_FILING_BANDS[slice].map((band) => `\`${band}\``).join(" or ");
}

