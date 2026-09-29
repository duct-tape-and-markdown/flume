/**
 * The `<prior-attempt>` block of a rendered prompt — the one cut both the
 * renderer's own cases (`tests/Prompt.test.ts`) and the dispatcher's retry
 * cases (`tests/Dispatcher.test.ts`) read that block through.
 */

import { expect } from "vitest";

const OPEN = "<prior-attempt>";
const CLOSE = "</prior-attempt>";

/**
 * The block, tags included, with its presence pinned as it is cut.
 *
 * A claim about what the block says reads this rather than the whole render.
 * A prompt also carries the `<harness>` fence, the assigned entry and the
 * phase's own task body, so a negative over all of it turns on whatever those
 * happen to spell — a worktree path, an entry tag, a gate's command — rather
 * than on the block the case is about (`.claude/rules/posture-sweep.md`, *A
 * negative assertion over a whole rendered artifact*).
 */
export function priorAttemptBlock(rendered: string): string {
  const block = priorAttemptBlockIfAny(rendered);
  if (block === undefined) {
    throw new Error(`the render carries no ${OPEN} block`);
  }
  return block;
}

/**
 * The same cut with an absent block as an answer rather than a failure — what a
 * case about a render that must **omit** the block asserts against.
 *
 * A `not.toContain` of the tag over the whole render is the same defect as one
 * over what the block says: the subject is a prompt carrying a fence, an entry
 * and a task body, so the assertion turns on whatever those quote. This answers
 * for the block alone (`.claude/rules/posture-sweep.md`, *Standing lenses*).
 */
export function priorAttemptBlockIfAny(rendered: string): string | undefined {
  const open = rendered.indexOf(OPEN);
  if (open < 0) return undefined;
  const close = rendered.indexOf(CLOSE);
  expect(close, `the ${OPEN} block is unclosed`).toBeGreaterThan(open);
  return rendered.slice(open, close + CLOSE.length);
}
