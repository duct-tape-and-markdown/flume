/**
 * The stale-pid helper, covered from the default lane — the lane that runs
 * under the build's `afterMerge` gate. Every claim and pidfile case across
 * both lanes plants what `deadPid` (`tests/helpers/deadPid.ts`) mints, so the
 * property those cases lean on is pinned once, here.
 *
 * The pin reads the pid through `process.kill` directly rather than through
 * the helper's own probe: a mint checked by the checker that minted it pins
 * self-agreement and nothing else (`.claude/rules/engineering.md`, "A seam
 * gate reads what the real writer wrote").
 */

import { expect, it, vi } from "vitest";

import { deadPid } from "./helpers/deadPid.ts";

/** The errno the host raises for a pid it holds no process for. */
const signalZero = (pid: number): string | undefined => {
  try {
    process.kill(pid, 0);
    return undefined;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code;
  }
};

it("the shared stale-pid helper's pid names no live process", () => {
  const pid = deadPid();

  expect(pid).toBeGreaterThan(0);
  expect(signalZero(pid)).toBe("ESRCH");
  // Non-vacuity: the same read over a pid that is certainly live — this very
  // process — reaches it, so the verdict above is the minted pid's and not a
  // probe that reports every pid dead (`.claude/rules/engineering.md`, "A
  // green verdict is proven non-vacuous").
  expect(signalZero(process.pid)).toBeUndefined();
});

it("the stale-pid helper probes its candidate on every mint", () => {
  // The number is stable, so a case may mint at any point in its body; what
  // is never reused is the *check*. A fixture that probed once and handed the
  // answer out afterwards is the shape this helper replaces.
  const probe = vi.spyOn(process, "kill");
  try {
    const first = deadPid();
    const second = deadPid();

    expect(second).toBe(first);
    expect(
      probe.mock.calls.filter(([, signal]) => signal === 0).map(([pid]) => pid),
    ).toEqual([first, second]);
  } finally {
    probe.mockRestore();
  }
});
