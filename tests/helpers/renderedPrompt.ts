/**
 * The structural cuts of a rendered prompt other than the `<prior-attempt>`
 * block (`tests/helpers/priorAttemptBlock.ts`, which owns that one): the
 * `<harness>` block's labelled leads, the task body past every
 * dispatcher-owned block, and the indented listing beneath a lead.
 *
 * A render carries the `<harness>` fence, an optional prior-attempt record and
 * the phase's own task body, so a claim about one of them asserted over the
 * whole string turns on whatever the others happen to quote — a worktree path,
 * an entry tag, a gate's command. Each function here answers one part, so the
 * claim can be a positive total over it (`.claude/rules/posture-sweep.md`, *A
 * negative assertion over a whole rendered artifact*).
 */

import { expect } from "vitest";

const HARNESS_OPEN = "<harness>";
const HARNESS_CLOSE = "</harness>";
const PRIOR_CLOSE = "</prior-attempt>";

/** The `<harness>` block, tags included, with its presence pinned as it is cut. */
function harnessBlock(rendered: string): string {
  const open = rendered.indexOf(HARNESS_OPEN);
  expect(open, `the render carries no ${HARNESS_OPEN} block`).toBeGreaterThan(-1);
  const close = rendered.indexOf(HARNESS_CLOSE);
  expect(close, `the ${HARNESS_OPEN} block is unclosed`).toBeGreaterThan(open);
  return rendered.slice(open, close + HARNESS_CLOSE.length);
}

/**
 * Every labelled lead the `<harness>` block states, in render order — each
 * line of the block that ends in a colon.
 *
 * This is the subject a claim about *which* fence the block named asserts a
 * total over: a lead the renderer no longer emits, one it emits beside
 * another, and one it reworded all red here.
 */
export function harnessLeads(rendered: string): string[] {
  return harnessBlock(rendered)
    .split("\n")
    .filter((line) => line.endsWith(":"));
}

/**
 * The task body — everything past the dispatcher-owned blocks, which is what a
 * claim about placeholder substitution or inline-exec output reads.
 */
export function taskBody(rendered: string): string {
  const prior = rendered.indexOf(PRIOR_CLOSE);
  if (prior > -1) return rendered.slice(prior + PRIOR_CLOSE.length + 1);
  const harness = rendered.indexOf(HARNESS_CLOSE);
  expect(harness, `the render carries no ${HARNESS_CLOSE}`).toBeGreaterThan(-1);
  return rendered.slice(harness + HARNESS_CLOSE.length + 1);
}

/**
 * The indented listing beneath `lead` — the lines carrying `indent`, that
 * prefix stripped, stopping at the first line that does not.
 *
 * The listing, not the lead's presence, is the total a case about a rendered
 * set asserts: an extra member, a missing one and an elision line the writer
 * appended are each visible in it.
 */
export function listingUnder(
  text: string,
  lead: string,
  indent = "  - ",
): string[] {
  const lines = text.split("\n");
  const start = lines.findIndex((line) => line.startsWith(lead));
  if (start < 0) throw new Error(`the render carries no \`${lead}\` listing`);
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => !line.startsWith(indent));
  return (end === -1 ? rest : rest.slice(0, end)).map((line) =>
    line.slice(indent.length),
  );
}
