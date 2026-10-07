/**
 * `superviseLoop` — the `flume loop` outer supervisor (`src/loopSupervisor.ts`).
 *
 * Moved here with the module when the supervisor left `src/Dispatcher.ts`;
 * the suites are unchanged but for their import paths. Every one of them
 * drives the real `superviseLoop` with a stubbed `runTick` that writes
 * the phase's verdict file directly — the child-process seam — rather than running
 * a real wave, whose own mechanism `tests/Dispatcher.test.ts` proves.
 */

import { existsSync } from "node:fs";
import { mkdir, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FAILURE_STAGES, superviseLoop } from "../src/loopSupervisor.ts";
import type {
  FailureStage,
  SuperviseResult,
  TickChildRequest,
} from "../src/loopSupervisor.ts";
import { EX_MOUNT_DEAD, EX_TERMINAL_MISCONFIG } from "../src/exitCodes.ts";
import type { Logger } from "../src/log.ts";
import type {
  TickVerdict,
  TickVerdictInvocation,
} from "../src/tickVerdict.ts";
import { runEndPath, slugify, stopFlagPath } from "../src/paths.ts";
import {
  readRunEnd,
  signalledStop,
  type RunEndRecord,
} from "../src/runEnd.ts";
import { Baton } from "../src/Baton.ts";
import { loopCompletionSummary, loopExitCode } from "../src/cliVerdict.ts";
import { denyDirectory, denyFile } from "./helpers/denial.ts";
import {
  childVerdictPath,
  makeFixture,
  silent,
  verdictFixture,
  writeMinimalChain,
  type Fixture,
} from "./helpers/dispatcherFixture.ts";
import { SPAWN_BUDGET_MS } from "./helpers/subprocess.ts";
import { waitFor } from "./helpers/waitFor.ts";

// `makeFixture` seeds a temp repository through real `git` plumbing, so every
// case and hook here starts processes: the lane's one budget is declared once
// at file scope rather than inherited from the runner's 5s defaults
// (`SPAWN_BUDGET_MS`, `tests/helpers/subprocess.ts`).
vi.setConfig({ testTimeout: SPAWN_BUDGET_MS, hookTimeout: SPAWN_BUDGET_MS });

/**
 * The `tag`/`quarantineKey` pair a real tick's stage-failure record carries
 * (`StageFailureEntry`, `src/tickVerdict.ts`). Hand-authored here because the
 * `superviseLoop` suites write the verdict file directly rather than
 * running a wave — the supervisor treats the key as opaque, so any
 * well-formed value exercises it. The engine-side formula is pinned instead
 * by the suites that drive a real wave through a real failure.
 */
function blamedOnFixture(
  tag: string,
  hash = "00112233aa",
): { tag: string; quarantineKey: string } {
  return { tag, quarantineKey: `${slugify(tag)}@${hash}` };
}

let fx: Fixture;

beforeEach(async () => {
  fx = await makeFixture();
});

afterEach(async () => {
  await fx.cleanup();
});

/**
 * The extraction pin: `superviseLoop` is reachable from its own module, so
 * the suites below are driving `src/loopSupervisor.ts` rather than a
 * re-export left behind in `src/Dispatcher.ts`.
 */
describe("src/loopSupervisor.ts — the supervisor's own module", () => {
  it("superviseLoop is exported from src/loopSupervisor.ts", () => {
    expect(typeof superviseLoop).toBe("function");
  });
});

/**
 * The run's teardown, at the supervisor's own seam (spec/loop.md "The loop
 * lock and the tip claim"): the caller aborts, the abort reaches whoever
 * holds the in-flight tick child, and `superviseLoop` resolves only once
 * that tick has settled — which is what lets `flume loop`'s signal handler
 * drop `loop.pid` and the tip claim with no writer of this run's left under
 * the state root. The real runner's terminate-and-reap is exercised through
 * the CLI in `tests/cli.test.ts`; here the stub stands in for the child.
 */
describe("superviseLoop — the run's teardown reaches the in-flight tick", () => {
  it("an aborted stopSignal reaches the running tick's runner, and the run resolves only after that tick settles, spawning no further child", async () => {
    // Awake for the whole case: hibernation never ends this run, and
    // the budget is 5, so a second `runTick` call would mean the abort was
    // read by nothing.
    const baton = new Baton(join(fx.repo, ".flume"));
    baton.wake("build");

    const stop = new AbortController();
    const seen: AbortSignal[] = [];
    let abortedInsideRunner = false;
    let inFlightSettled = false;
    const runTick = async ({
      stopSignal,
    }: TickChildRequest): Promise<{ exitCode: number | null }> => {
      seen.push(stopSignal);
      // The operator's signal lands mid-tick — the moment the real runner
      // turns into a kill on the child it holds.
      stop.abort();
      abortedInsideRunner = stopSignal.aborted;
      // ...and the runner resolves only once that child is gone.
      await new Promise((r) => setTimeout(r, 10));
      inFlightSettled = true;
      return { exitCode: 0 };
    };

    const res = await superviseLoop({
      repoRoot: fx.repo,
      tickBudget: 5,
      runTick,
      stopSignal: stop.signal,
      log: silent,
    });

    expect(seen).toHaveLength(1);
    expect(abortedInsideRunner).toBe(true);
    expect(inFlightSettled).toBe(true);
    expect(res.ticks).toBe(1);
    expect(res.hibernated).toBe(false);
    // The phase is still awake — the run ended on the signal, not on a
    // baton state the supervisor could have reached on its own.
    expect(baton.awake()).toContain("build");
  });
});

describe("superviseLoop — tip-moved counts as errored", () => {
  it("a tip-moved tick is distinguishable in the run's errored-tick classification, even though it is never a NoCommitMode", async () => {
    const baton = new Baton(join(fx.repo, ".flume"));
    baton.wake("build");
    const verdictPath = childVerdictPath(join(fx.repo, ".flume"), "build");

    const runTick = async (): Promise<{ exitCode: number | null }> => {
      await writeFile(
        verdictPath,
        JSON.stringify(
          verdictFixture({
            committed: false,
            tipMoved: true,
            summary: "build: no commit (tip-moved) → hibernate",
          }),
        ),
        "utf8",
      );
      baton.sleep("build");
      return { exitCode: 0 };
    };

    const res = await superviseLoop({
      repoRoot: fx.repo,
      tickBudget: 5,
      runTick,
      log: silent,
    });

    expect(res.hibernated).toBe(true);
    expect(res.ticks).toBe(1);
    expect(res.erroredTicks).toHaveLength(1);
    expect(res.erroredTicks[0]).toContain("tip-moved");
  });
});

/**
 * spec/loop.md "Graceful stop — the stop flag": the per-iteration check reads
 * the flag's *presence*, and `existsSync` read every stat failure as absence
 * — so a flag that is on disk but unstattable let the run tick on past the
 * operator's stop. The check now throws on anything but ENOENT
 * (`existsLoud`, src/fsProbe.ts), the disposition `baton.hibernating()`'s
 * `readdirSync` one line below already takes.
 */
describe('superviseLoop — an unstattable stop flag is loud (.claude/rules/engineering.md "Loud or nothing")', () => {
  it("the supervisor's per-iteration stop check throws on a non-ENOENT stop-flag stat instead of ticking on", async () => {
    const flumeDir = join(fx.repo, ".flume");
    await mkdir(flumeDir, { recursive: true });
    // Never slept: hibernation can never be what ends this run, so ticking
    // on would burn every one of the --max iterations below.
    new Baton(flumeDir).wake("plan");
    // ELOOP — present, unstattable. Not a permission bit: a root-run test
    // would bypass that.
    await symlink("stop", join(flumeDir, "stop"));

    let calls = 0;
    const runTick = (): Promise<{ exitCode: number | null }> => {
      calls++;
      return Promise.resolve({ exitCode: 0 });
    };

    await expect(
      superviseLoop({ repoRoot: fx.repo, tickBudget: 3, runTick, log: silent }),
    ).rejects.toThrow(/ELOOP|stop/);

    // The in-flight tick still completed; the throw lands at the very next
    // boundary rather than after --max.
    expect(calls).toBe(1);
  });

  it("an absent stop flag stays silent — the run ends at hibernation exactly as before", async () => {
    const flumeDir = join(fx.repo, ".flume");
    const baton = new Baton(flumeDir);
    baton.wake("plan");
    expect(existsSync(join(flumeDir, "stop"))).toBe(false);

    let calls = 0;
    const runTick = (): Promise<{ exitCode: number | null }> => {
      calls++;
      baton.sleep("plan");
      return Promise.resolve({ exitCode: 0 });
    };

    const res = await superviseLoop({
      repoRoot: fx.repo,
      tickBudget: 3,
      runTick,
      log: silent,
    });

    expect(calls).toBe(1);
    expect(res.hibernated).toBe(true);
    expect(res.stoppedByFlag).toBeUndefined();
  });

  it("a present, stattable stop flag ends the run after the in-flight tick, unchanged", async () => {
    const flumeDir = join(fx.repo, ".flume");
    await mkdir(flumeDir, { recursive: true });
    new Baton(flumeDir).wake("plan"); // never slept — the stop must end it
    await writeFile(join(flumeDir, "stop"), "", "utf8");

    let calls = 0;
    const runTick = (): Promise<{ exitCode: number | null }> => {
      calls++;
      return Promise.resolve({ exitCode: 0 });
    };

    const res = await superviseLoop({
      repoRoot: fx.repo,
      tickBudget: 3,
      runTick,
      log: silent,
    });

    expect(calls).toBe(1);
    expect(res.ticks).toBe(1);
    expect(res.stoppedByFlag).toBe(true);
  });
});

describe("superviseLoop — process-per-tick supervisor", () => {
  it("spawns exactly one child per iteration and stops at hibernation", async () => {
    const baton = new Baton(join(fx.repo, ".flume"));
    baton.wake("plan");

    let calls = 0;
    const runTick = (): Promise<{ exitCode: number | null }> => {
      calls++;
      // Simulate the child `flume tick`: after 3 ticks the phase sleeps
      // itself and hands off to nothing → the on-disk baton empties → the
      // supervisor reads hibernation (disk-is-truth) and stops.
      if (calls >= 3) baton.sleep("plan");
      return Promise.resolve({ exitCode: 0 });
    };

    const res = await superviseLoop({
      repoRoot: fx.repo,
      tickBudget: 50,
      runTick,
      log: silent,
    });

    expect(calls).toBe(3);
    expect(res.ticks).toBe(3);
    expect(res.hibernated).toBe(true);
  });

  it("stops at --max when the chain never hibernates", async () => {
    new Baton(join(fx.repo, ".flume")).wake("plan"); // never slept → never hibernates

    let calls = 0;
    const runTick = (): Promise<{ exitCode: number | null }> => {
      calls++;
      return Promise.resolve({ exitCode: 0 });
    };

    const res = await superviseLoop({
      repoRoot: fx.repo,
      tickBudget: 4,
      runTick,
      log: silent,
    });

    expect(calls).toBe(4);
    expect(res.ticks).toBe(4);
    expect(res.hibernated).toBe(false);
  });

  it("mount-dead: child exits EX_MOUNT_DEAD → supervisor aborts on first occurrence, never burns to --max", async () => {
    new Baton(join(fx.repo, ".flume")).wake("plan"); // an aborted tick does no baton work

    const errors: string[] = [];
    const rec: Logger = {
      info: () => {},
      warn: () => {},
      error: (l) => errors.push(l),
    };

    let calls = 0;
    const runTick = (): Promise<{ exitCode: number | null }> => {
      calls++;
      return Promise.resolve({ exitCode: EX_MOUNT_DEAD });
    };

    const res = await superviseLoop({
      repoRoot: fx.repo,
      tickBudget: 3,
      runTick,
      log: rec,
    });

    // Immediate stop: one tick's worth of work, never the remaining --max
    // ticks re-hitting the same unloadable chain.
    expect(calls).toBe(1);
    expect(res.ticks).toBe(1);
    expect(res.hibernated).toBe(false);
    expect(res.mountDead).toBe(true);
    expect(errors.some((e) => /mount-dead/.test(e))).toBe(true);
  });

  /**
   * Shipped/errored cross the child→supervisor boundary by disk
   * (`<flumeDir>/tick-verdict/<phase>.json`), not stdio: child stdio stays
   * `inherit`, so the exit code alone can't carry a run-wide total. Two
   * ticks in one run: the first ships an entry and writes a clean verdict,
   * the second is a gate-revert (errored) and writes that verdict before
   * sleeping the phase so the loop hibernates. `runTick` here plays the real
   * child `flume tick` process — the CLI's `tick` command writes exactly
   * this artifact around its own `dispatcher.tick()` call (the write/clear
   * primitives' own round-trip is proved directly in the
   * `writeTickVerdict / clearTickVerdict / readTickVerdicts` suite above);
   * `errored` itself is derived from `noCommit`/`shippedTags` at the read
   * site, not stored on the verdict — this suite proves `superviseLoop`
   * derives and accumulates it correctly.
   */
  it("a run with one errored tick and one shipped entry: SuperviseResult reports shipped>0 and errored>0, error named", async () => {
    const baton = new Baton(join(fx.repo, ".flume"));
    baton.wake("build");
    const verdictPath = childVerdictPath(join(fx.repo, ".flume"), "build");

    let calls = 0;
    const runTick = async (): Promise<{ exitCode: number | null }> => {
      calls++;
      if (calls === 1) {
        await writeFile(
          verdictPath,
          JSON.stringify(
            verdictFixture({ committed: true, shippedTags: ["SHIPPED-ENTRY"] }),
          ),
          "utf8",
        );
      } else {
        await writeFile(
          verdictPath,
          JSON.stringify(
            verdictFixture({
              committed: false,
              noCommit: "gate-revert",
              summary: "build: no commit (gate-revert) → hibernate",
            }),
          ),
          "utf8",
        );
        baton.sleep("build");
      }
      return { exitCode: 0 };
    };

    const res = await superviseLoop({
      repoRoot: fx.repo,
      tickBudget: 5,
      runTick,
      log: silent,
    });

    expect(res.hibernated).toBe(true);
    expect(res.ticks).toBe(2);
    expect(res.shippedTags).toEqual(["SHIPPED-ENTRY"]);
    expect(res.erroredTicks).toHaveLength(1);
    expect(res.erroredTicks[0]).toContain("gate-revert");
  });

  /**
   * The read's refusal is a fact about the run, not a crash of it: uncaught,
   * the throw out of `readTickVerdict` (`src/tickVerdict.ts`) would take the
   * whole `SuperviseResult` with it — the ticks already run, what they
   * shipped, what they cost — and `flume loop` would print a stack instead
   * of a summary. The run ends, keeping its totals and naming the wall.
   */
  it("a verdict present but unreadable ends the run with its totals intact, never a thrown-away SuperviseResult", async () => {
    const baton = new Baton(join(fx.repo, ".flume"));
    baton.wake("build");
    const verdictPath = childVerdictPath(join(fx.repo, ".flume"), "build");

    let calls = 0;
    const runTick = async (): Promise<{ exitCode: number | null }> => {
      calls++;
      if (calls === 1) {
        await writeFile(
          verdictPath,
          JSON.stringify(
            verdictFixture({ committed: true, shippedTags: ["SHIPPED-ENTRY"] }),
          ),
          "utf8",
        );
      } else {
        // The second child leaves its verdict at a path that stats present
        // and refuses the read (`tests/helpers/denial.ts`) — what an operator
        // sees when something else owns that path. The phase stays awake, so
        // a supervisor that shrugged this off would keep ticking.
        denyFile(verdictPath);
      }
      return { exitCode: 0 };
    };

    const errors: string[] = [];
    const log: Logger = {
      ...silent,
      error: (m: string) => {
        errors.push(m);
      },
    };

    const res = await superviseLoop({
      repoRoot: fx.repo,
      tickBudget: 5,
      runTick,
      log,
    });

    // Non-vacuity: the first tick really did run and really did ship, so the
    // totals below are a run's rather than an empty result's.
    expect(calls).toBe(2);
    expect(res.ticks).toBe(2);
    expect(res.shippedTags).toEqual(["SHIPPED-ENTRY"]);
    // Ended on the refusal, not on hibernation — the baton still carries the
    // awake flag the second child never slept.
    expect(res.hibernated).toBe(false);
    expect(baton.awake()).toEqual(["build"]);
    expect(res.erroredTicks).toHaveLength(1);
    expect(res.erroredTicks[0]).toContain("unreadable");
    expect(errors.some((e) => e.includes(verdictPath))).toBe(true);
  });

  it("render-refused counts as errored — a broken prompt is a genuine failure, not a clean-exit no-op", async () => {
    const baton = new Baton(join(fx.repo, ".flume"));
    baton.wake("build");
    const verdictPath = childVerdictPath(join(fx.repo, ".flume"), "build");

    const runTick = async (): Promise<{ exitCode: number | null }> => {
      await writeFile(
        verdictPath,
        JSON.stringify(
          verdictFixture({
            committed: false,
            noCommit: "render-refused",
            summary: "build: no commit (render-refused) → hibernate",
          }),
        ),
        "utf8",
      );
      baton.sleep("build");
      return { exitCode: 0 };
    };

    const res = await superviseLoop({
      repoRoot: fx.repo,
      tickBudget: 5,
      runTick,
      log: silent,
    });

    expect(res.hibernated).toBe(true);
    expect(res.ticks).toBe(1);
    expect(res.erroredTicks).toHaveLength(1);
    expect(res.erroredTicks[0]).toContain("render-refused");
  });

  /**
   * LOOP-ERRORED-TICKS-SILENT-EXIT — a child can exit non-zero without ever
   * reaching the verdict write: the CJS-context refusal (2), the
   * detached-HEAD/harness-error refusal (1), an uncaught throw out of
   * `Dispatcher.tick`. None of these are `EX_TERMINAL_MISCONFIG` (78) or
   * `EX_MOUNT_DEAD` (69) — those fail-fast on their own axis — so before this
   * fix they fell into the generic non-zero warn-and-continue branch and
   * contributed nothing to `erroredTicks`: a run that never shipped anything
   * and never wrote a single verdict still reported zero errored ticks.
   */
  it("a child exiting non-zero with no verdict written on disk is counted in the run's erroredTicks total", async () => {
    new Baton(join(fx.repo, ".flume")).wake("build"); // never slept → never hibernates

    let calls = 0;
    const runTick = async (): Promise<{ exitCode: number | null }> => {
      calls++;
      // No verdict write at all — this is the "died before
      // reaching the write" shape the fix targets.
      return { exitCode: 1 };
    };

    const res = await superviseLoop({
      repoRoot: fx.repo,
      tickBudget: 3,
      runTick,
      log: silent,
    });

    expect(calls).toBe(3);
    expect(res.ticks).toBe(3);
    expect(res.hibernated).toBe(false);
    expect(res.shippedTags).toEqual([]);
    expect(res.erroredTicks).toHaveLength(3);
    for (const line of res.erroredTicks) {
      expect(line).toContain("exited 1");
    }
  });

  it("fail-fasts on a child's 78: stops after one tick, names the orphaned phases, leaves the flags", async () => {
    const baton = new Baton(join(fx.repo, ".flume"));
    // The orphaned flag keeps hibernating() false — the stop must come from
    // the exit signal alone, never from re-reading the broken baton state.
    baton.wake("ghost");

    const errors: string[] = [];
    const rec: Logger = {
      info: () => {},
      warn: () => {},
      error: (l) => errors.push(l),
    };

    let calls = 0;
    const runTick = (): Promise<{ exitCode: number | null }> => {
      calls++;
      return Promise.resolve({ exitCode: EX_TERMINAL_MISCONFIG });
    };

    const res = await superviseLoop({
      repoRoot: fx.repo,
      tickBudget: 5,
      runTick,
      log: rec,
    });

    // Immediate stop: no further ticks despite --max 5 and a non-empty baton.
    expect(calls).toBe(1);
    expect(res.ticks).toBe(1);
    expect(res.hibernated).toBe(false);
    expect(res.terminal).toEqual({ kind: "orphaned-awake", phases: ["ghost"] });
    expect(
      errors.some(
        (e) => /terminal misconfiguration/.test(e) && /ghost/.test(e),
      ),
    ).toBe(true);
    // The supervisor never clears the flag either — diagnosability over tidiness.
    expect(baton.isAwake("ghost")).toBe(true);
  });
});

/**
 * spec/loop.md "Exit codes — the run never lies to CI": fa03a39 generalized
 * the repeated-failure backstop to the merge stage (`mergeFailures` on the
 * verdict) but left this accounting provision-only — a wave that ships nothing
 * because every entry hit a cherry-pick conflict recorded `mergeFailures` with
 * no `gate-revert`/`platform-preempt`/`render-refused`/`tipMoved` and no
 * `provisionFailures`, so it fell through every leg of the `errored` formula
 * and the run could burn every `--max` tick wedged on merge conflicts while
 * `loopExitCode` still read 0. Sibling coverage to the provisioning-only
 * errored-accounting tests above, same `runTick` fixture idiom.
 */
describe("superviseLoop — merge-stage-only failure counts as errored (loop-merge-failure-errored-accounting)", () => {
  const verdictPath = (phase: string): string =>
    childVerdictPath(join(fx.repo, ".flume"), phase);

  it("a tick recording only mergeFailures with zero shippedTags and no gate revert is counted in erroredTicks", async () => {
    const baton = new Baton(join(fx.repo, ".flume"));
    baton.wake("build");

    const runTick = async ({ phase }: TickChildRequest): Promise<{ exitCode: number | null }> => {
      await writeFile(
        verdictPath(phase),
        JSON.stringify(
          verdictFixture({
            committed: false,
            summary: "build: no commit — merge failed",
            mergeFailures: [
              {
                ...blamedOnFixture("CONFLICT-A"),
                signature: "cherry-pick conflict in src/shared.ts",
                message:
                  "error: could not apply ...: conflict in src/shared.ts",
              },
            ],
          }),
        ),
        "utf8",
      );
      baton.sleep("build");
      return { exitCode: 0 };
    };

    const res = await superviseLoop({
      repoRoot: fx.repo,
      tickBudget: 5,
      runTick,
      log: silent,
    });

    expect(res.hibernated).toBe(true);
    expect(res.ticks).toBe(1);
    expect(res.shippedTags).toEqual([]);
    expect(res.erroredTicks).toHaveLength(1);
    expect(res.erroredTicks[0]).toContain("merge failed");
    expect(res.erroredTicks[0]).toContain("CONFLICT-A");
  });

  it("loopExitCode returns non-zero for a run whose every tick fails purely at the merge stage", async () => {
    new Baton(join(fx.repo, ".flume")).wake("build"); // never slept → never hibernates

    // A distinct signature every tick, so this isolates the errored-tick
    // accounting fix from the separate consecutive-identical-signature
    // backstop (which would independently force a non-zero exit at 3).
    let calls = 0;
    const runTick = async ({ phase }: TickChildRequest): Promise<{ exitCode: number | null }> => {
      calls++;
      const signature = `cherry-pick conflict in src/file-${calls}.ts`;
      await writeFile(
        verdictPath(phase),
        JSON.stringify(
          verdictFixture({
            committed: false,
            summary: "build: no commit — merge failed",
            mergeFailures: [
              {
                ...blamedOnFixture(`CONFLICT-${calls}`),
                signature,
                message: signature,
              },
            ],
          }),
        ),
        "utf8",
      );
      return { exitCode: 0 };
    };

    const res = await superviseLoop({
      repoRoot: fx.repo,
      tickBudget: 3,
      runTick,
      log: silent,
    });

    expect(calls).toBe(3);
    expect(res.repeatedFailure).toBeUndefined();
    expect(res.shippedTags).toEqual([]);
    expect(res.erroredTicks).toHaveLength(3);
    expect(loopExitCode(res)).not.toBe(0);
  });

  it("a mergeFailure alongside a successful ship in the same wave stays out of erroredTicks (partial success remains exit 0)", async () => {
    const baton = new Baton(join(fx.repo, ".flume"));
    baton.wake("build");

    const runTick = async ({ phase }: TickChildRequest): Promise<{ exitCode: number | null }> => {
      await writeFile(
        verdictPath(phase),
        JSON.stringify(
          verdictFixture({
            committed: true,
            shippedTags: ["OK-A"],
            summary: "build shipped OK-A",
            mergeFailures: [
              {
                ...blamedOnFixture("CONFLICT-B"),
                signature: "cherry-pick conflict in src/shared.ts",
                message:
                  "error: could not apply ...: conflict in src/shared.ts",
              },
            ],
          }),
        ),
        "utf8",
      );
      baton.sleep("build");
      return { exitCode: 0 };
    };

    const res = await superviseLoop({
      repoRoot: fx.repo,
      tickBudget: 5,
      runTick,
      log: silent,
    });

    expect(res.hibernated).toBe(true);
    expect(res.shippedTags).toEqual(["OK-A"]);
    expect(res.erroredTicks).toHaveLength(0);
    expect(loopExitCode(res)).toBe(0);
  });
});

/**
 * spec/loop.md "The tick verdict — one facts artifact", *No interpretation
 * fields*: `not-shipped` has two causes, and only one of them is the chain
 * declining. A `shipped` predicate that *threw* never made a ship decision
 * at all, and the verdict distinguishes the two on both surfaces the wave
 * writes: `threw` on the merge outcome (`TickVerdictMergeOutcome`) for a
 * chain reading the entry's fate, and a `ShipFailure` record beside it for
 * the run's accounting — so the supervisor's errored
 * allowlist reads them apart rather than treating a broken predicate as a
 * deliberate park. The stub writes both, as the real producer does
 * (`src/waveMerge.ts`). Same `runTick` fixture idiom as the errored-accounting
 * suites above.
 */
describe("superviseLoop — a thrown shipped predicate counts as errored (not-shipped's two causes)", () => {
  const verdictPath = (phase: string): string =>
    childVerdictPath(join(fx.repo, ".flume"), phase);

  /** A tick whose wave landed a commit the `shipped` hook then threw on. */
  const notShippedTick =
    (over: { threw?: string }) =>
    async ({ phase }: TickChildRequest): Promise<{ exitCode: number | null }> => {
      const baton = new Baton(join(fx.repo, ".flume"));
      await writeFile(
        verdictPath(phase),
        JSON.stringify(
          verdictFixture({
            committed: false,
            shippedTags: [],
            summary: "build: PARKED cherry-picked but not shipped",
            mergeOutcomes: [
              {
                entryTag: "PARKED",
                outcome: "not-shipped",
                baseSha: "a".repeat(40),
                headSha: "b".repeat(40),
                ...(over.threw === undefined ? {} : { threw: over.threw }),
              },
            ],
            ...(over.threw === undefined
              ? {}
              : {
                  shipFailures: [
                    {
                      ...blamedOnFixture("PARKED"),
                      signature: over.threw,
                      message: over.threw,
                    },
                  ],
                }),
          }),
        ),
        "utf8",
      );
      baton.sleep("build");
      return { exitCode: 0 };
    };

  it("a not-shipped outcome carrying the shipped hook's throw counts the tick errored", async () => {
    new Baton(join(fx.repo, ".flume")).wake("build");

    const res = await superviseLoop({
      repoRoot: fx.repo,
      tickBudget: 5,
      runTick: notShippedTick({
        threw: "TypeError: cannot read properties of undefined",
      }),
      log: silent,
    });

    expect(res.ticks).toBe(1);
    expect(res.shippedTags).toEqual([]);
    expect(res.erroredTicks).toHaveLength(1);
    expect(res.erroredTicks[0]).toContain("PARKED");
    expect(res.erroredTicks[0]).toContain("TypeError");
    expect(loopExitCode(res)).not.toBe(0);
  });

  it("a not-shipped outcome the chain returned counts no tick errored", async () => {
    new Baton(join(fx.repo, ".flume")).wake("build");

    const res = await superviseLoop({
      repoRoot: fx.repo,
      tickBudget: 5,
      runTick: notShippedTick({}),
      log: silent,
    });

    expect(res.ticks).toBe(1);
    expect(res.erroredTicks).toEqual([]);
    expect(loopExitCode(res)).toBe(0);
  });
});

/**
 * The supervisor-level legs `superviseLoop` owns: a tagged
 * provisioning failure quarantines its slug for the rest of the run (and
 * that quarantine crosses to the next child tick via `runTick`'s
 * `quarantinedSlugs` argument, mirroring how the real CLI carries it over
 * `FLUME_QUARANTINED_SLUGS`); the same failure signature repeating on three
 * consecutive ticks with no successful tick between them aborts the run; a
 * signature that stops repeating resets the streak. `runTick` here plays the
 * real child `flume tick` process exactly as the suite above does — it
 * writes the verdict file directly rather than exercising a real fanout
 * wave (that mechanism is proved in the `Dispatcher fanout — pre-tick
 * worktree provisioning failure isolates one entry` suite).
 */
describe("superviseLoop — provisioning-failure quarantine & consecutive-failure abort backstop", () => {
  const verdictPath = (phase: string): string =>
    childVerdictPath(join(fx.repo, ".flume"), phase);

  it("quarantines a tagged failure after its first tick and carries it to the next child tick", async () => {
    const baton = new Baton(join(fx.repo, ".flume"));
    baton.wake("build");

    const receivedSlugs: Array<string[]> = [];
    let calls = 0;
    const runTick = async ({
      phase,
      quarantinedSlugs,
    }: TickChildRequest): Promise<{ exitCode: number | null }> => {
      calls++;
      receivedSlugs.push([...quarantinedSlugs].sort());
      if (calls === 1) {
        await writeFile(
          verdictPath(phase),
          JSON.stringify(
            verdictFixture({
              committed: true,
              shippedTags: ["OK-A"],
              provisionFailures: [
                {
                  ...blamedOnFixture("HELD-ENTRY"),
                  signature: "EBUSY: resource busy or locked",
                  message: "EBUSY: resource busy or locked, rmdir '...'",
                },
              ],
            }),
          ),
          "utf8",
        );
      } else {
        await writeFile(
          verdictPath(phase),
          JSON.stringify(verdictFixture({ committed: false })),
          "utf8",
        );
        baton.sleep("build");
      }
      return { exitCode: 0 };
    };

    const warnings: string[] = [];
    const log: Logger = {
      info: () => {},
      warn: (l) => warnings.push(l),
      error: () => {},
    };

    const res = await superviseLoop({
      repoRoot: fx.repo,
      tickBudget: 5,
      runTick,
      log,
    });

    expect(res.hibernated).toBe(true);
    expect(res.ticks).toBe(2);
    expect(res.shippedTags).toEqual(["OK-A"]);
    // Nothing quarantined yet going into the first tick; the slug the first
    // tick's failure names is quarantined going into the second.
    expect(receivedSlugs[0]).toEqual([]);
    expect(receivedSlugs[1]).toEqual(["held-entry@00112233aa"]);
    expect(
      warnings.some((w) => w.includes("HELD-ENTRY") && w.includes("EBUSY")),
    ).toBe(true);
  });

  it("aborts after the same untagged signature fails 3 consecutive ticks with no successful tick between", async () => {
    const baton = new Baton(join(fx.repo, ".flume"));
    baton.wake("build"); // never hibernates — the abort must come from the backstop alone

    const SIGNATURE = "git worktree prune: fatal: not a git repository";
    let calls = 0;
    const runTick = async ({ phase }: TickChildRequest): Promise<{ exitCode: number | null }> => {
      calls++;
      await writeFile(
        verdictPath(phase),
        JSON.stringify(
          verdictFixture({
            committed: false,
            summary: "build: no commit — worktree provisioning failed",
            provisionFailures: [{ signature: SIGNATURE, message: SIGNATURE }],
          }),
        ),
        "utf8",
      );
      return { exitCode: 0 };
    };

    const errors: string[] = [];
    const log: Logger = {
      info: () => {},
      warn: () => {},
      error: (l) => errors.push(l),
    };

    const res = await superviseLoop({
      repoRoot: fx.repo,
      tickBudget: 10,
      runTick,
      log,
    });

    // Aborted on the 3rd consecutive occurrence, never burning to --max 10.
    expect(calls).toBe(3);
    expect(res.ticks).toBe(3);
    expect(res.hibernated).toBe(false);
    expect(res.repeatedFailure).toEqual({
      stage: "provision",
      signature: SIGNATURE,
      count: 3,
    });
    expect(errors.some((e) => e.includes(SIGNATURE))).toBe(true);
  });

  it("aborts on a repeated signature buried behind a varying sibling at index 0 every tick", async () => {
    const baton = new Baton(join(fx.repo, ".flume"));
    baton.wake("build"); // never hibernates — the abort must come from the backstop alone

    const REPEATED_SIGNATURE =
      "git worktree prune: fatal: not a git repository";
    let calls = 0;
    const runTick = async ({ phase }: TickChildRequest): Promise<{ exitCode: number | null }> => {
      calls++;
      await writeFile(
        verdictPath(phase),
        JSON.stringify(
          verdictFixture({
            committed: false,
            summary: "build: no commit — worktree provisioning failed",
            // The repo-level failure (untagged) always lands first in
            // runFanout's push order; a distinct per-entry signature every
            // tick sits at index 0 and must not shadow the one that's
            // actually repeating behind it.
            provisionFailures: [
              {
                ...blamedOnFixture(`VARYING-${calls}`),
                signature: `EBUSY: resource busy or locked (attempt ${calls})`,
                message: `EBUSY: resource busy or locked (attempt ${calls})`,
              },
              { signature: REPEATED_SIGNATURE, message: REPEATED_SIGNATURE },
            ],
          }),
        ),
        "utf8",
      );
      return { exitCode: 0 };
    };

    const errors: string[] = [];
    const log: Logger = {
      info: () => {},
      warn: () => {},
      error: (l) => errors.push(l),
    };

    const res = await superviseLoop({
      repoRoot: fx.repo,
      tickBudget: 10,
      runTick,
      log,
    });

    // Aborted on the 3rd consecutive occurrence of the buried signature,
    // never burning to --max 10.
    expect(calls).toBe(3);
    expect(res.ticks).toBe(3);
    expect(res.hibernated).toBe(false);
    expect(res.repeatedFailure).toEqual({
      stage: "provision",
      signature: REPEATED_SIGNATURE,
      count: 3,
    });
    expect(errors.some((e) => e.includes(REPEATED_SIGNATURE))).toBe(true);
  });

  it("a failure that clears on the next tick resets the streak — the backstop never trips", async () => {
    const baton = new Baton(join(fx.repo, ".flume"));
    baton.wake("build");

    const SIGNATURE = "git worktree prune: fatal: not a git repository";
    let calls = 0;
    const runTick = async ({ phase }: TickChildRequest): Promise<{ exitCode: number | null }> => {
      calls++;
      if (calls === 1 || calls === 3) {
        await writeFile(
          verdictPath(phase),
          JSON.stringify(
            verdictFixture({
              committed: false,
              summary: "build: no commit — worktree provisioning failed",
              provisionFailures: [{ signature: SIGNATURE, message: SIGNATURE }],
            }),
          ),
          "utf8",
        );
      } else if (calls === 2) {
        // Transient — the wall didn't recur this tick.
        await writeFile(
          verdictPath(phase),
          JSON.stringify(verdictFixture({ committed: false })),
          "utf8",
        );
      } else {
        await writeFile(
          verdictPath(phase),
          JSON.stringify(verdictFixture({ committed: false })),
          "utf8",
        );
        baton.sleep("build");
      }
      return { exitCode: 0 };
    };

    const res = await superviseLoop({
      repoRoot: fx.repo,
      tickBudget: 10,
      runTick,
      log: silent,
    });

    expect(calls).toBe(4);
    expect(res.ticks).toBe(4);
    expect(res.hibernated).toBe(true);
    expect(res.repeatedFailure).toBeUndefined();
  });

  // The other side of the two cases above: they stop a run short of its
  // budget because the wall recorded a failure fact for the streak fold to
  // count. A clean exit records none — no provision, render, merge, gate,
  // ship or platform failure — so the same slice walling every tick is
  // invisible to the backstop, and `tickBudget` is the only thing that ends
  // the run. The budget is the bound `harness/handoff.ts`'s `wakeSet` names,
  // and this is where it is paid.
  it("a run of nothing but clean-exit ticks spends its whole budget and never reaches the repeated-failure abort", async () => {
    const baton = new Baton(join(fx.repo, ".flume"));
    baton.wake("build"); // never hibernates — only the budget can end this run

    const BUDGET = 6;
    const written: Array<TickVerdict> = [];
    const runTick = async ({
      phase,
    }: TickChildRequest): Promise<{ exitCode: number | null }> => {
      const verdict = verdictFixture({
        committed: false,
        noCommit: "clean-exit",
        summary: "build: no commit — agent exited cleanly",
      });
      written.push(verdict);
      await writeFile(verdictPath(phase), JSON.stringify(verdict), "utf8");
      return { exitCode: 0 };
    };

    const res = await superviseLoop({
      repoRoot: fx.repo,
      tickBudget: BUDGET,
      runTick,
      log: silent,
    });

    // Vacuity: the run has to have produced clean-exit ticks for the absence
    // of an abort to mean anything, and each one has to be free of every
    // stage's failure record — a fixture that quietly grew one would make the
    // backstop's silence a property of the fixture instead of the mode.
    expect(written.length).toBe(BUDGET);
    for (const v of written) {
      expect(v.noCommit).toBe("clean-exit");
      expect(v.provisionFailures ?? []).toEqual([]);
      expect(v.renderFailures ?? []).toEqual([]);
      expect(v.mergeFailures ?? []).toEqual([]);
      expect(v.gateFailures ?? []).toEqual([]);
      expect(v.shipFailures ?? []).toEqual([]);
      expect(v.platformFailures ?? []).toEqual([]);
    }

    expect(res.ticks).toBe(BUDGET);
    expect(res.repeatedFailure).toBeUndefined();
    expect(res.hibernated).toBe(false);
    expect(res.erroredTicks).toEqual([]);
  });
});

/**
 * spec/loop.md "Repeated identical failures — quarantine, then abort"
 * generalizes both backstop legs past provisioning to the render, merge and
 * gate stages, and the backstop alone to the platform stage, whose own suite
 * is below — sibling coverage to the provision-only suite above, same `runTick`
 * fixture idiom (a stub writing the verdict file directly, standing in for
 * a real fanout wave/singleton tick whose own mechanism the Dispatcher-level
 * suites above prove).
 */
describe("superviseLoop — the repeated-failure backstop generalizes to merge- and gate-stage failures", () => {
  const verdictPath = (phase: string): string =>
    childVerdictPath(join(fx.repo, ".flume"), phase);

  it("quarantines a tagged merge-stage failure exactly like a tagged provisioning failure", async () => {
    const baton = new Baton(join(fx.repo, ".flume"));
    baton.wake("build");

    const receivedSlugs: Array<string[]> = [];
    let calls = 0;
    const runTick = async ({
      phase,
      quarantinedSlugs,
    }: TickChildRequest): Promise<{ exitCode: number | null }> => {
      calls++;
      receivedSlugs.push([...quarantinedSlugs].sort());
      if (calls === 1) {
        await writeFile(
          verdictPath(phase),
          JSON.stringify(
            verdictFixture({
              committed: true,
              shippedTags: ["OK-A"],
              mergeFailures: [
                {
                  ...blamedOnFixture("CONFLICT-B"),
                  signature: "cherry-pick conflict in src/shared.ts",
                  message:
                    "error: could not apply ...: conflict in src/shared.ts",
                },
              ],
            }),
          ),
          "utf8",
        );
      } else {
        await writeFile(
          verdictPath(phase),
          JSON.stringify(verdictFixture({ committed: false })),
          "utf8",
        );
        baton.sleep("build");
      }
      return { exitCode: 0 };
    };

    const warnings: string[] = [];
    const log: Logger = {
      info: () => {},
      warn: (l) => warnings.push(l),
      error: () => {},
    };

    const res = await superviseLoop({
      repoRoot: fx.repo,
      tickBudget: 5,
      runTick,
      log,
    });

    expect(res.hibernated).toBe(true);
    expect(res.ticks).toBe(2);
    expect(res.shippedTags).toEqual(["OK-A"]);
    expect(receivedSlugs[0]).toEqual([]);
    expect(receivedSlugs[1]).toEqual(["conflict-b@00112233aa"]);
    expect(
      warnings.some(
        (w) => w.includes("CONFLICT-B") && w.includes("merge-stage"),
      ),
    ).toBe(true);
  });

  it("quarantines a tagged gate-stage failure exactly like a tagged provisioning failure", async () => {
    const baton = new Baton(join(fx.repo, ".flume"));
    baton.wake("build");

    const receivedSlugs: Array<string[]> = [];
    let calls = 0;
    const runTick = async ({
      phase,
      quarantinedSlugs,
    }: TickChildRequest): Promise<{ exitCode: number | null }> => {
      calls++;
      receivedSlugs.push([...quarantinedSlugs].sort());
      if (calls === 1) {
        await writeFile(
          verdictPath(phase),
          JSON.stringify(
            verdictFixture({
              committed: true,
              shippedTags: ["OK-A"],
              gateFailures: [
                {
                  ...blamedOnFixture("ISO-FAIL"),
                  signature: "iso-veto: iso veto",
                  message: "iso veto",
                },
              ],
            }),
          ),
          "utf8",
        );
      } else {
        await writeFile(
          verdictPath(phase),
          JSON.stringify(verdictFixture({ committed: false })),
          "utf8",
        );
        baton.sleep("build");
      }
      return { exitCode: 0 };
    };

    const warnings: string[] = [];
    const log: Logger = {
      info: () => {},
      warn: (l) => warnings.push(l),
      error: () => {},
    };

    const res = await superviseLoop({
      repoRoot: fx.repo,
      tickBudget: 5,
      runTick,
      log,
    });

    expect(res.hibernated).toBe(true);
    expect(res.ticks).toBe(2);
    expect(receivedSlugs[0]).toEqual([]);
    expect(receivedSlugs[1]).toEqual(["iso-fail@00112233aa"]);
    expect(
      warnings.some((w) => w.includes("ISO-FAIL") && w.includes("gate-stage")),
    ).toBe(true);
  });

  it("aborts after the same merge-stage signature fails 3 consecutive ticks with no successful tick between", async () => {
    const baton = new Baton(join(fx.repo, ".flume"));
    baton.wake("build"); // never hibernates — the abort must come from the backstop alone

    const SIGNATURE = "error: could not apply ...: conflict in src/shared.ts";
    let calls = 0;
    const runTick = async ({ phase }: TickChildRequest): Promise<{ exitCode: number | null }> => {
      calls++;
      await writeFile(
        verdictPath(phase),
        JSON.stringify(
          verdictFixture({
            committed: false,
            mergeFailures: [
              {
                ...blamedOnFixture("CONFLICT-B"),
                signature: SIGNATURE,
                message: SIGNATURE,
              },
            ],
          }),
        ),
        "utf8",
      );
      return { exitCode: 0 };
    };

    const errors: string[] = [];
    const log: Logger = {
      info: () => {},
      warn: () => {},
      error: (l) => errors.push(l),
    };

    const res = await superviseLoop({
      repoRoot: fx.repo,
      tickBudget: 10,
      runTick,
      log,
    });

    expect(calls).toBe(3);
    expect(res.ticks).toBe(3);
    expect(res.hibernated).toBe(false);
    // The exposed shape carries the raw signature and its stage as separate
    // fields — the streak key's `${stage}:` prefix never reaches `signature`.
    expect(res.repeatedFailure).toEqual({
      stage: "merge",
      signature: SIGNATURE,
      count: 3,
    });
    expect(errors.some((e) => e.includes(SIGNATURE))).toBe(true);
  });

  it("aborts after the same untagged gate-stage signature fails 3 consecutive ticks (a singleton's own gate revert has no entry to quarantine)", async () => {
    const baton = new Baton(join(fx.repo, ".flume"));
    baton.wake("plan"); // never hibernates — the abort must come from the backstop alone

    const SIGNATURE = "tsc: no commit — tsc failed";
    let calls = 0;
    const runTick = async ({ phase }: TickChildRequest): Promise<{ exitCode: number | null }> => {
      calls++;
      await writeFile(
        verdictPath(phase),
        JSON.stringify(
          verdictFixture({
            phaseName: "plan",
            committed: false,
            noCommit: "gate-revert",
            gateFailures: [{ signature: SIGNATURE, message: SIGNATURE }],
          }),
        ),
        "utf8",
      );
      return { exitCode: 0 };
    };

    const errors: string[] = [];
    const log: Logger = {
      info: () => {},
      warn: () => {},
      error: (l) => errors.push(l),
    };

    const res = await superviseLoop({
      repoRoot: fx.repo,
      tickBudget: 10,
      runTick,
      log,
    });

    expect(calls).toBe(3);
    expect(res.ticks).toBe(3);
    expect(res.hibernated).toBe(false);
    expect(res.repeatedFailure).toEqual({
      stage: "gate",
      signature: SIGNATURE,
      count: 3,
    });
    expect(errors.some((e) => e.includes(SIGNATURE))).toBe(true);
  });

  it("a clean exit never joins the accounting, however many times it repeats", async () => {
    const baton = new Baton(join(fx.repo, ".flume"));
    baton.wake("plan");

    const receivedSlugs: Array<string[]> = [];
    let calls = 0;
    const runTick = async ({
      phase,
      quarantinedSlugs,
    }: TickChildRequest): Promise<{ exitCode: number | null }> => {
      calls++;
      receivedSlugs.push([...quarantinedSlugs].sort());
      await writeFile(
        verdictPath(phase),
        JSON.stringify(
          verdictFixture({
            phaseName: "plan",
            committed: false,
            noCommit: "clean-exit",
          }),
        ),
        "utf8",
      );
      if (calls >= 5) baton.sleep("plan");
      return { exitCode: 0 };
    };

    const res = await superviseLoop({
      repoRoot: fx.repo,
      tickBudget: 10,
      runTick,
      log: silent,
    });

    expect(calls).toBe(5);
    expect(res.ticks).toBe(5);
    expect(res.hibernated).toBe(true);
    expect(res.repeatedFailure).toBeUndefined();
    // No failure record means nothing to quarantine either.
    expect(receivedSlugs.every((s) => s.length === 0)).toBe(true);
  });

  it("a merge-stage and a gate-stage failure sharing identical signature text keep independent streaks — a quiet tick for one stage clears only that stage's streak", async () => {
    const baton = new Baton(join(fx.repo, ".flume"));
    baton.wake("build"); // never hibernates — the abort must come from the backstop alone

    const SHARED_TEXT = "boom";
    let calls = 0;
    const runTick = async ({ phase }: TickChildRequest): Promise<{ exitCode: number | null }> => {
      calls++;
      if (calls === 1) {
        // Tick 1: a merge-stage failure with the shared text — starts a
        // merge-stage streak of 1.
        await writeFile(
          verdictPath(phase),
          JSON.stringify(
            verdictFixture({
              committed: false,
              mergeFailures: [
                {
                  ...blamedOnFixture("CONFLICT-B"),
                  signature: SHARED_TEXT,
                  message: SHARED_TEXT,
                },
              ],
            }),
          ),
          "utf8",
        );
      } else {
        // Ticks 2-4: a gate-stage failure with the identical text and no
        // merge failure at all — this tick clears the merge-stage streak
        // (recording no failure of that class) while accumulating its own,
        // separately-keyed gate-stage streak.
        await writeFile(
          verdictPath(phase),
          JSON.stringify(
            verdictFixture({
              committed: false,
              gateFailures: [{ signature: SHARED_TEXT, message: SHARED_TEXT }],
            }),
          ),
          "utf8",
        );
      }
      return { exitCode: 0 };
    };

    const res = await superviseLoop({
      repoRoot: fx.repo,
      tickBudget: 10,
      runTick,
      log: silent,
    });

    // If the merge-stage tick's count had leaked into the gate-stage streak,
    // the abort would fire on tick 3 (1 carried + 2 more = 3) instead of
    // tick 4 (the gate-stage streak's own 3rd occurrence).
    expect(calls).toBe(4);
    expect(res.ticks).toBe(4);
    expect(res.hibernated).toBe(false);
    expect(res.repeatedFailure).toEqual({
      stage: "gate",
      signature: SHARED_TEXT,
      count: 3,
    });
  });
});

/**
 * spec/loop.md "Repeated identical failures — quarantine, then abort": render
 * is the stage with no other per-entry trace — a refusal leaves no failing
 * `gateResults` row and no `mergeOutcomes` record, and a wave that shipped a
 * sibling loses even the tick-level `noCommit` — so without this leg an entry
 * whose prompt refuses deterministically is re-picked at full agent price
 * every wave to `--max`. Same `runTick` fixture idiom as the sibling suites: a
 * stub writes the `renderFailures` record (`src/tickVerdict.ts`) a real child
 * would, whose own production `tests/Dispatcher.test.ts` proves.
 */
describe("superviseLoop — the render stage joins the quarantine and the backstop", () => {
  const verdictPath = (phase: string): string =>
    childVerdictPath(join(fx.repo, ".flume"), phase);

  it("a blamed render refusal quarantines its entry for the run", async () => {
    const baton = new Baton(join(fx.repo, ".flume"));
    baton.wake("build");

    const receivedSlugs: Array<string[]> = [];
    let calls = 0;
    const runTick = async ({
      phase,
      quarantinedSlugs,
    }: TickChildRequest): Promise<{ exitCode: number | null }> => {
      calls++;
      receivedSlugs.push([...quarantinedSlugs].sort());
      if (calls === 1) {
        // The wave ships OK-A and refuses to render UNRENDERABLE-B: the
        // shipped sibling swallows the tick-level `noCommit`, so this record
        // is the only trace the refusal leaves.
        await writeFile(
          verdictPath(phase),
          JSON.stringify(
            verdictFixture({
              committed: true,
              shippedTags: ["OK-A"],
              renderFailures: [
                {
                  ...blamedOnFixture("UNRENDERABLE-B"),
                  signature: "inline exec failed: pnpm -s flume-context",
                  message:
                    "inline exec failed: pnpm -s flume-context — exit 1: no such script",
                },
              ],
            }),
          ),
          "utf8",
        );
      } else {
        // Same tip as the placing tick, so nothing lifts the hold: the entry
        // is held for the rest of the run.
        await writeFile(
          verdictPath(phase),
          JSON.stringify(verdictFixture({ committed: false })),
          "utf8",
        );
        baton.sleep("build");
      }
      return { exitCode: 0 };
    };

    const warnings: string[] = [];
    const log: Logger = {
      info: () => {},
      warn: (l) => warnings.push(l),
      error: () => {},
    };

    const res = await superviseLoop({
      repoRoot: fx.repo,
      tickBudget: 5,
      runTick,
      log,
    });

    expect(res.hibernated).toBe(true);
    expect(res.ticks).toBe(2);
    expect(res.shippedTags).toEqual(["OK-A"]);
    expect(receivedSlugs[0]).toEqual([]);
    expect(receivedSlugs[1]).toEqual(["unrenderable-b@00112233aa"]);
    expect(
      warnings.some(
        (w) => w.includes("UNRENDERABLE-B") && w.includes("render-stage"),
      ),
    ).toBe(true);
  });

  it("an unbroken streak of the identical render refusal aborts the loop at the threshold", async () => {
    const baton = new Baton(join(fx.repo, ".flume"));
    baton.wake("build"); // never hibernates — the abort comes from the backstop alone

    // A singleton phase's own refusal: no entry to blame, so nothing to
    // quarantine and the backstop is the only brake on the burn.
    const SIGNATURE = "inline exec failed: pnpm -s flume-context";
    let calls = 0;
    const runTick = async ({
      phase,
    }: TickChildRequest): Promise<{ exitCode: number | null }> => {
      calls++;
      await writeFile(
        verdictPath(phase),
        JSON.stringify(
          verdictFixture({
            committed: false,
            noCommit: "render-refused",
            renderFailures: [
              { signature: SIGNATURE, message: `${SIGNATURE} — exit 1` },
            ],
          }),
        ),
        "utf8",
      );
      return { exitCode: 0 };
    };

    const errors: string[] = [];
    const res = await superviseLoop({
      repoRoot: fx.repo,
      tickBudget: 10,
      runTick,
      log: { info: () => {}, warn: () => {}, error: (l) => errors.push(l) },
    });

    // The default threshold, reached and stopped at: the remaining seven
    // ticks of the budget are never spent against the same refusal.
    expect(calls).toBe(3);
    expect(res.ticks).toBe(3);
    expect(res.hibernated).toBe(false);
    expect(res.repeatedFailure).toEqual({
      stage: "render",
      signature: SIGNATURE,
      count: 3,
    });
    expect(
      errors.some((e) => e.includes("render-stage") && e.includes(SIGNATURE)),
    ).toBe(true);
  });
});

/**
 * spec/loop.md "Repeated identical failures — quarantine, then abort": a
 * run-scoped hold is keyed by the entry as the failing tick read it, and a
 * *render*-, *gate*-, *merge*- or *ship*-stage hold carries one more expiry —
 * the tip
 * that tick reported. Once trunk has moved past it the tree that gate judged,
 * the trunk that pick conflicted against, or the declaration that render read
 * and that the same chain's `shipped` predicate was consulted from,
 * is gone, so the hold lifts and the entry is pickable again; a
 * provision-stage hold has no such expiry, since nothing landing on trunk
 * changes what a worktree could not provision, and a platform-stage failure
 * places no hold for any of this to reach. The tip each tick reports is
 * `TickVerdict.headSha`, which the stub writes here exactly as a real child
 * does — the supervisor reads no ref of its own.
 */
describe("superviseLoop — a render-, gate-, merge- or ship-stage hold expires with the tip it was placed at", () => {
  const verdictPath = (phase: string): string =>
    childVerdictPath(join(fx.repo, ".flume"), phase);

  const TIP_A = "a".repeat(40);
  const TIP_B = "b".repeat(40);

  it("a render-stage quarantine hold lifts once a verdict reports a different tip", async () => {
    const baton = new Baton(join(fx.repo, ".flume"));
    baton.wake("build");

    const receivedSlugs: Array<string[]> = [];
    let calls = 0;
    const runTick = async ({
      phase,
      quarantinedSlugs,
    }: TickChildRequest): Promise<{ exitCode: number | null }> => {
      calls++;
      receivedSlugs.push([...quarantinedSlugs].sort());
      if (calls === 1) {
        // The chain's own `promptArgs` hook throws over the tree at TIP_A,
        // and the tick ends with trunk still there.
        await writeFile(
          verdictPath(phase),
          JSON.stringify(
            verdictFixture({
              committed: false,
              headSha: TIP_A,
              noCommit: "render-refused",
              renderFailures: [
                {
                  ...blamedOnFixture("UNRENDERABLE-B"),
                  signature: "promptArgs hook threw: ctx.entry is undefined",
                  message: "promptArgs hook threw: ctx.entry is undefined",
                },
              ],
            }),
          ),
          "utf8",
        );
      } else if (calls === 2) {
        // The hold stands over the tree it was placed on: this tick is told
        // the key, and it is this tick that moves trunk — the operator's hook
        // fix, or any sibling landing.
        await writeFile(
          verdictPath(phase),
          JSON.stringify(
            verdictFixture({
              committed: true,
              headSha: TIP_B,
              shippedTags: ["OK-B"],
            }),
          ),
          "utf8",
        );
      } else {
        // Trunk is no longer the tree that render read, so the entry is
        // pickable again and the next refusal is a fresh one to judge.
        await writeFile(
          verdictPath(phase),
          JSON.stringify(verdictFixture({ committed: false, headSha: TIP_B })),
          "utf8",
        );
        baton.sleep("build");
      }
      return { exitCode: 0 };
    };

    const infos: string[] = [];
    const log: Logger = {
      info: (l) => infos.push(l),
      warn: () => {},
      error: () => {},
    };

    const res = await superviseLoop({
      repoRoot: fx.repo,
      tickBudget: 5,
      runTick,
      log,
    });

    expect(res.ticks).toBe(3);
    expect(receivedSlugs).toEqual([[], ["unrenderable-b@00112233aa"], []]);
    expect(
      infos.some(
        (l) =>
          l.includes("lifting the render-stage quarantine") &&
          l.includes("UNRENDERABLE-B"),
      ),
    ).toBe(true);
  });

  it("a gate-stage quarantine is lifted once the tip moves past the tick that placed it", async () => {
    const baton = new Baton(join(fx.repo, ".flume"));
    baton.wake("build");

    const receivedSlugs: Array<string[]> = [];
    let calls = 0;
    const runTick = async ({
      phase,
      quarantinedSlugs,
    }: TickChildRequest): Promise<{ exitCode: number | null }> => {
      calls++;
      receivedSlugs.push([...quarantinedSlugs].sort());
      if (calls === 1) {
        // The gate reverts ISO-FAIL over the tree at TIP_A, and the tick ends
        // with trunk still there (nothing shipped).
        await writeFile(
          verdictPath(phase),
          JSON.stringify(
            verdictFixture({
              committed: false,
              headSha: TIP_A,
              gateFailures: [
                {
                  ...blamedOnFixture("ISO-FAIL"),
                  signature: "iso-veto: iso veto",
                  message: "iso veto",
                },
              ],
            }),
          ),
          "utf8",
        );
      } else if (calls === 2) {
        // The hold still stands over the tree it was placed on: this tick is
        // told the key, and it is this tick that moves trunk (the operator's
        // gate fix, or any sibling landing).
        await writeFile(
          verdictPath(phase),
          JSON.stringify(
            verdictFixture({
              committed: true,
              headSha: TIP_B,
              shippedTags: ["OK-B"],
            }),
          ),
          "utf8",
        );
      } else {
        await writeFile(
          verdictPath(phase),
          JSON.stringify(verdictFixture({ committed: false, headSha: TIP_B })),
          "utf8",
        );
        baton.sleep("build");
      }
      return { exitCode: 0 };
    };

    const infos: string[] = [];
    const log: Logger = {
      info: (l) => infos.push(l),
      warn: () => {},
      error: () => {},
    };

    const res = await superviseLoop({
      repoRoot: fx.repo,
      tickBudget: 5,
      runTick,
      log,
    });

    expect(res.ticks).toBe(3);
    expect(receivedSlugs).toEqual([[], ["iso-fail@00112233aa"], []]);
    expect(
      infos.some(
        (l) =>
          l.includes("lifting the gate-stage quarantine") &&
          l.includes("ISO-FAIL"),
      ),
    ).toBe(true);
  });

  it("a merge-stage quarantine is lifted once the newest reported tip differs from the tick that placed it", async () => {
    const baton = new Baton(join(fx.repo, ".flume"));
    baton.wake("build");

    const receivedSlugs: Array<string[]> = [];
    let calls = 0;
    const runTick = async ({
      phase,
      quarantinedSlugs,
    }: TickChildRequest): Promise<{ exitCode: number | null }> => {
      calls++;
      receivedSlugs.push([...quarantinedSlugs].sort());
      if (calls === 1) {
        // CONFLICT-A's cherry-pick conflicts against trunk at TIP_A, and the
        // tick ends with trunk still there.
        await writeFile(
          verdictPath(phase),
          JSON.stringify(
            verdictFixture({
              committed: false,
              headSha: TIP_A,
              mergeFailures: [
                {
                  ...blamedOnFixture("CONFLICT-A"),
                  signature: "CONFLICT (content): Merge conflict in src/a.ts",
                  message: "CONFLICT (content): Merge conflict in src/a.ts",
                },
              ],
            }),
          ),
          "utf8",
        );
      } else if (calls === 2) {
        // The hold still stands over the trunk it was placed against: this
        // tick is told the key, and it is this tick that moves trunk — the
        // world the conflicting pick was attempted onto is now gone, so a
        // fresh pick is a different question.
        await writeFile(
          verdictPath(phase),
          JSON.stringify(
            verdictFixture({
              committed: true,
              headSha: TIP_B,
              shippedTags: ["OK-B"],
            }),
          ),
          "utf8",
        );
      } else {
        await writeFile(
          verdictPath(phase),
          JSON.stringify(verdictFixture({ committed: false, headSha: TIP_B })),
          "utf8",
        );
        baton.sleep("build");
      }
      return { exitCode: 0 };
    };

    const infos: string[] = [];
    const log: Logger = {
      info: (l) => infos.push(l),
      warn: () => {},
      error: () => {},
    };

    const res = await superviseLoop({
      repoRoot: fx.repo,
      tickBudget: 5,
      runTick,
      log,
    });

    expect(res.ticks).toBe(3);
    expect(receivedSlugs).toEqual([[], ["conflict-a@00112233aa"], []]);
    expect(
      infos.some(
        (l) =>
          l.includes("lifting the merge-stage quarantine") &&
          l.includes("CONFLICT-A"),
      ),
    ).toBe(true);
  });

  it("a ship-stage quarantine hold lifts once the tip its placing verdict reported has moved", async () => {
    const baton = new Baton(join(fx.repo, ".flume"));
    baton.wake("build");

    const receivedSlugs: Array<string[]> = [];
    const written: TickVerdict[] = [];
    let calls = 0;
    const runTick = async ({
      phase,
      quarantinedSlugs,
    }: TickChildRequest): Promise<{ exitCode: number | null }> => {
      calls++;
      receivedSlugs.push([...quarantinedSlugs].sort());
      const verdict =
        calls === 1
          ? // The chain's `shipped` predicate throws over the declaration
            // trunk holds at TIP_A. The pick landed, so the tick reports
            // TIP_A as the tip it ended at.
            verdictFixture({
              committed: false,
              headSha: TIP_A,
              shipFailures: [
                {
                  ...blamedOnFixture("THROWN-SHIP"),
                  signature: "shipped hook threw: ctx.gateResults is undefined",
                  message: "shipped hook threw: ctx.gateResults is undefined",
                },
              ],
            })
          : calls === 2
            ? // The hold stands over the declaration it was placed on: this
              // tick is told the key, and it is this tick that moves trunk —
              // the operator's hook fix, or any sibling landing.
              verdictFixture({
                committed: true,
                headSha: TIP_B,
                shippedTags: ["OK-B"],
              })
            : // Trunk is no longer the tree the throwing predicate was
              // consulted over, so the entry is pickable again.
              verdictFixture({ committed: false, headSha: TIP_B });
      written.push(verdict);
      await writeFile(verdictPath(phase), JSON.stringify(verdict), "utf8");
      if (calls >= 3) baton.sleep("build");
      return { exitCode: 0 };
    };

    const infos: string[] = [];
    const res = await superviseLoop({
      repoRoot: fx.repo,
      tickBudget: 5,
      runTick,
      log: { info: (l) => infos.push(l), warn: () => {}, error: () => {} },
    });

    expect(res.ticks).toBe(3);
    // Vacuity pin: the hold this case watches expire was placed by a record
    // that actually reached the supervisor, at the tip the lift is judged
    // against (`.claude/rules/engineering.md`, *A green verdict is proven
    // non-vacuous*).
    expect(written[0]?.shipFailures ?? []).toHaveLength(1);
    expect(written[0]?.headSha).toBe(TIP_A);
    expect(written[1]?.headSha).toBe(TIP_B);

    expect(receivedSlugs).toEqual([[], ["thrown-ship@00112233aa"], []]);
    expect(
      infos.some(
        (l) =>
          l.includes("lifting the ship-stage quarantine") &&
          l.includes("THROWN-SHIP"),
      ),
    ).toBe(true);
  });

  it("a provision-stage quarantine survives a tip that moved", async () => {
    const baton = new Baton(join(fx.repo, ".flume"));
    baton.wake("build");

    const receivedSlugs: Array<string[]> = [];
    let calls = 0;
    const runTick = async ({
      phase,
      quarantinedSlugs,
    }: TickChildRequest): Promise<{ exitCode: number | null }> => {
      calls++;
      receivedSlugs.push([...quarantinedSlugs].sort());
      if (calls === 1) {
        // One wave, two blamed failures at the same tip: a worktree that
        // could not be provisioned and a gate revert. The gate sibling is
        // what makes "survives" a claim about the stage rather than about a
        // run where nothing lifted at all.
        await writeFile(
          verdictPath(phase),
          JSON.stringify(
            verdictFixture({
              committed: false,
              headSha: TIP_A,
              provisionFailures: [
                {
                  ...blamedOnFixture("PROV-A"),
                  signature: "fatal: could not create work tree dir",
                  message: "fatal: could not create work tree dir",
                },
              ],
              gateFailures: [
                {
                  ...blamedOnFixture("GATE-B"),
                  signature: "iso-veto: iso veto",
                  message: "iso veto",
                },
              ],
            }),
          ),
          "utf8",
        );
      } else if (calls === 2) {
        await writeFile(
          verdictPath(phase),
          JSON.stringify(
            verdictFixture({
              committed: true,
              headSha: TIP_B,
              shippedTags: ["OK-C"],
            }),
          ),
          "utf8",
        );
      } else {
        await writeFile(
          verdictPath(phase),
          JSON.stringify(verdictFixture({ committed: false, headSha: TIP_B })),
          "utf8",
        );
        baton.sleep("build");
      }
      return { exitCode: 0 };
    };

    const res = await superviseLoop({
      repoRoot: fx.repo,
      tickBudget: 5,
      runTick,
      log: silent,
    });

    expect(res.ticks).toBe(3);
    expect(receivedSlugs[1]).toEqual([
      "gate-b@00112233aa",
      "prov-a@00112233aa",
    ]);
    // Trunk moved between tick 2 and tick 3: the gate hold goes, the
    // provisioning hold stays for the rest of the run.
    expect(receivedSlugs[2]).toEqual(["prov-a@00112233aa"]);
  });
});

/**
 * `SuperviseLoopOptions.quarantineScope` /
 * `abortThreshold` open the two constants the suite above exercises at
 * their shipped defaults (run-scoped quarantine; three-failure abort) as
 * chain-overridable config. The CLI forwards a resolved chain's
 * `supervisorPolicy` block into these same options (`loopVerb`,
 * `src/cliLoop.ts`); this suite proves `superviseLoop` itself, the same
 * seam the prior suite already proves defaults through when neither option
 * is passed.
 */
describe("superviseLoop — supervisor policy knobs override the shipped defaults", () => {
  const verdictPath = (phase: string): string =>
    childVerdictPath(join(fx.repo, ".flume"), phase);

  it("abortThreshold: 2 aborts on the second consecutive identical signature, not the third", async () => {
    const baton = new Baton(join(fx.repo, ".flume"));
    baton.wake("build");

    const SIGNATURE = "git worktree prune: fatal: not a git repository";
    let calls = 0;
    const runTick = async ({ phase }: TickChildRequest): Promise<{ exitCode: number | null }> => {
      calls++;
      await writeFile(
        verdictPath(phase),
        JSON.stringify(
          verdictFixture({
            committed: false,
            summary: "build: no commit — worktree provisioning failed",
            provisionFailures: [{ signature: SIGNATURE, message: SIGNATURE }],
          }),
        ),
        "utf8",
      );
      return { exitCode: 0 };
    };

    const res = await superviseLoop({
      repoRoot: fx.repo,
      tickBudget: 10,
      runTick,
      log: silent,
      abortThreshold: 2,
    });

    expect(calls).toBe(2);
    expect(res.ticks).toBe(2);
    expect(res.hibernated).toBe(false);
    expect(res.repeatedFailure).toEqual({
      stage: "provision",
      signature: SIGNATURE,
      count: 2,
    });
  });

  it('quarantineScope: "none" never quarantines a tagged failure — later ticks still see the empty set', async () => {
    const baton = new Baton(join(fx.repo, ".flume"));
    baton.wake("build");

    const receivedSlugs: Array<string[]> = [];
    let calls = 0;
    const runTick = async ({
      phase,
      quarantinedSlugs,
    }: TickChildRequest): Promise<{ exitCode: number | null }> => {
      calls++;
      receivedSlugs.push([...quarantinedSlugs].sort());
      if (calls < 3) {
        await writeFile(
          verdictPath(phase),
          JSON.stringify(
            verdictFixture({
              committed: false,
              provisionFailures: [
                {
                  ...blamedOnFixture("HELD-ENTRY"),
                  signature: "EBUSY: resource busy or locked",
                  message: "EBUSY: resource busy or locked, rmdir '...'",
                },
              ],
            }),
          ),
          "utf8",
        );
      } else {
        await writeFile(
          verdictPath(phase),
          JSON.stringify(verdictFixture({ committed: false })),
          "utf8",
        );
        baton.sleep("build");
      }
      return { exitCode: 0 };
    };

    const res = await superviseLoop({
      repoRoot: fx.repo,
      tickBudget: 5,
      runTick,
      log: silent,
      quarantineScope: "none",
    });

    expect(res.hibernated).toBe(true);
    expect(res.ticks).toBe(3);
    // Every tick sees an empty quarantine set — the same tagged slug that
    // the default suite proves gets quarantined after tick 1 here never
    // does, because the identical signature repeats only twice before the
    // baton sleeps (never reaching the untouched abortThreshold default).
    expect(receivedSlugs).toEqual([[], [], []]);
  });

  it("a chain declaring neither supervisor knob gets both defaults: a run-scoped quarantine and a three-tick abort", async () => {
    const baton = new Baton(join(fx.repo, ".flume"));
    baton.wake("build");

    // Two failures, one per default. The blamed one exercises the
    // quarantine default: it appears on tick 1 only, exactly as a real run
    // behaves once the slug is withheld from later ticks. The repo-level one
    // (nothing to blame, nothing to quarantine) repeats every tick and
    // exercises the abort default.
    const HELD = blamedOnFixture("HELD-ENTRY");
    const BLAMED_SIGNATURE = "EBUSY: resource busy or locked";
    const SIGNATURE = "git worktree prune: fatal: not a git repository";
    const receivedSlugs: Array<string[]> = [];
    let calls = 0;
    const runTick = async ({
      phase,
      quarantinedSlugs,
    }: TickChildRequest): Promise<{ exitCode: number | null }> => {
      calls++;
      receivedSlugs.push([...quarantinedSlugs].sort());
      await writeFile(
        verdictPath(phase),
        JSON.stringify(
          verdictFixture({
            committed: false,
            summary: "build: no commit — worktree provisioning failed",
            provisionFailures: [
              ...(calls === 1
                ? [
                    {
                      ...HELD,
                      signature: BLAMED_SIGNATURE,
                      message: `${BLAMED_SIGNATURE}, rmdir '...'`,
                    },
                  ]
                : []),
              { signature: SIGNATURE, message: SIGNATURE },
            ],
          }),
        ),
        "utf8",
      );
      return { exitCode: 0 };
    };

    const res = await superviseLoop({
      repoRoot: fx.repo,
      tickBudget: 10,
      runTick,
      log: silent,
    });

    // Undeclared quarantineScope still holds the blamed slug for the rest of
    // the run — the "run" default, not the "none" the suite above overrides
    // to, and the hold outlives the tick whose failure raised it.
    expect(receivedSlugs).toEqual([
      [],
      [HELD.quarantineKey],
      [HELD.quarantineKey],
    ]);
    // Undeclared abortThreshold still aborts on the 3rd consecutive tick —
    // the shipped default, not the 2 the suite above overrides to.
    expect(calls).toBe(3);
    expect(res.ticks).toBe(3);
    expect(res.repeatedFailure).toEqual({
      stage: "provision",
      signature: SIGNATURE,
      count: 3,
    });
  });
});

/**
 * `superviseLoop`'s loop-end friction summary
 * (`logFrictionSummary`, `src/loopSupervisor.ts`), and the fix it rode
 * in on: the chain it loads comes from `opts.configDir`, not always
 * `<repoRoot>/.flume` (the old always-used default). `fx.configDir` is a
 * separate temp dir from `fx.repo/.flume` in this suite's fixture, so
 * passing it as `configDir` while leaving `<repoRoot>/.flume` chain-less
 * proves the plumbing: a summary that still finds the chain must have used
 * `opts.configDir`.
 */
describe("superviseLoop — loop-end friction summary & configDir plumbing", () => {
  it("logs the friction count line at the hibernation stop when declared and non-empty, loading the chain from opts.configDir", async () => {
    // The repo default has no chain.ts at all — only opts.configDir does.
    expect(existsSync(join(fx.repo, ".flume", "chain.ts"))).toBe(false);

    const baton = new Baton(join(fx.repo, ".flume"));
    baton.wake("plan");
    await writeMinimalChain(fx.configDir, { friction: "friction" });
    const frictionDir = join(fx.repo, ".flume", "friction");
    await mkdir(frictionDir, { recursive: true });
    await writeFile(join(frictionDir, "a.md"), "note\n");
    await writeFile(join(frictionDir, "b.md"), "note\n");

    let calls = 0;
    const runTick = (): Promise<{ exitCode: number | null }> => {
      calls++;
      if (calls >= 2) baton.sleep("plan");
      return Promise.resolve({ exitCode: 0 });
    };

    const infos: string[] = [];
    const res = await superviseLoop({
      repoRoot: fx.repo,
      configDir: fx.configDir,
      tickBudget: 5,
      runTick,
      log: { info: (l) => infos.push(l), warn: () => {}, error: () => {} },
    });

    expect(res.hibernated).toBe(true);
    expect(
      infos.some((l) => l.includes("friction: 2 note(s) await routing")),
    ).toBe(true);
  });

  it("omits the friction line at hibernation when the declared dir exists but holds no files", async () => {
    const baton = new Baton(join(fx.repo, ".flume"));
    baton.wake("plan");
    await writeMinimalChain(fx.configDir, { friction: "friction" });
    await mkdir(join(fx.repo, ".flume", "friction"), { recursive: true });

    let calls = 0;
    const runTick = (): Promise<{ exitCode: number | null }> => {
      calls++;
      if (calls >= 2) baton.sleep("plan");
      return Promise.resolve({ exitCode: 0 });
    };

    const infos: string[] = [];
    const res = await superviseLoop({
      repoRoot: fx.repo,
      configDir: fx.configDir,
      tickBudget: 5,
      runTick,
      log: { info: (l) => infos.push(l), warn: () => {}, error: () => {} },
    });

    expect(res.hibernated).toBe(true);
    expect(infos.some((l) => l.includes("hibernating after"))).toBe(true);
    expect(infos.some((l) => l.includes("friction:"))).toBe(false);
  });

  it("logs 'friction: unreadable' at hibernation instead of silently omitting the line, when the declared dir exists but readdir fails for a non-ENOENT reason (dispatcher-frictioncountline-loud-or-nothing)", async () => {
    const baton = new Baton(join(fx.repo, ".flume"));
    baton.wake("plan");
    await writeMinimalChain(fx.configDir, { friction: "friction" });
    const frictionDir = join(fx.repo, ".flume", "friction");
    await mkdir(frictionDir, { recursive: true });
    await writeFile(join(frictionDir, "a.md"), "note\n");
    // Deny the friction dir structurally (`tests/helpers/denial.ts`): readdir
    // now refuses, and not as ENOENT (`.claude/rules/engineering.md`, "Loud
    // or nothing") — on every host and under a root-run, where a mode
    // refuses nothing.
    denyDirectory(frictionDir);

    let calls = 0;
    const runTick = (): Promise<{ exitCode: number | null }> => {
      calls++;
      if (calls >= 2) baton.sleep("plan");
      return Promise.resolve({ exitCode: 0 });
    };

    const infos: string[] = [];
    const res = await superviseLoop({
      repoRoot: fx.repo,
      configDir: fx.configDir,
      tickBudget: 5,
      runTick,
      log: { info: (l) => infos.push(l), warn: () => {}, error: () => {} },
    });

    expect(res.hibernated).toBe(true);
    expect(infos.some((l) => l.includes("friction: unreadable"))).toBe(true);
  });

  it("omits the friction line at hibernation when Chain.friction is undeclared", async () => {
    const baton = new Baton(join(fx.repo, ".flume"));
    baton.wake("plan");
    await writeMinimalChain(fx.configDir); // no friction declared
    const frictionDir = join(fx.repo, ".flume", "friction");
    await mkdir(frictionDir, { recursive: true });
    await writeFile(join(frictionDir, "a.md"), "note\n");

    let calls = 0;
    const runTick = (): Promise<{ exitCode: number | null }> => {
      calls++;
      if (calls >= 2) baton.sleep("plan");
      return Promise.resolve({ exitCode: 0 });
    };

    const infos: string[] = [];
    const res = await superviseLoop({
      repoRoot: fx.repo,
      configDir: fx.configDir,
      tickBudget: 5,
      runTick,
      log: { info: (l) => infos.push(l), warn: () => {}, error: () => {} },
    });

    expect(res.hibernated).toBe(true);
    expect(infos.some((l) => l.includes("hibernating after"))).toBe(true);
    expect(infos.some((l) => l.includes("friction:"))).toBe(false);
  });

  it("logs the friction count line at the --max-reached stop when declared and non-empty", async () => {
    const baton = new Baton(join(fx.repo, ".flume"));
    baton.wake("plan"); // never sleeps → never hibernates
    await writeMinimalChain(fx.configDir, { friction: "friction" });
    const frictionDir = join(fx.repo, ".flume", "friction");
    await mkdir(frictionDir, { recursive: true });
    await writeFile(join(frictionDir, "a.md"), "note\n");

    const runTick = (): Promise<{ exitCode: number | null }> =>
      Promise.resolve({ exitCode: 0 });

    const infos: string[] = [];
    const res = await superviseLoop({
      repoRoot: fx.repo,
      configDir: fx.configDir,
      tickBudget: 2,
      runTick,
      log: { info: (l) => infos.push(l), warn: () => {}, error: () => {} },
    });

    expect(res.hibernated).toBe(false);
    expect(infos.some((l) => l.includes("reached --max 2"))).toBe(true);
    expect(
      infos.some((l) => l.includes("friction: 1 note(s) await routing")),
    ).toBe(true);
  });

  it("omits the friction line at the --max-reached stop when the declared dir is empty", async () => {
    const baton = new Baton(join(fx.repo, ".flume"));
    baton.wake("plan");
    await writeMinimalChain(fx.configDir, { friction: "friction" });
    await mkdir(join(fx.repo, ".flume", "friction"), { recursive: true });

    const runTick = (): Promise<{ exitCode: number | null }> =>
      Promise.resolve({ exitCode: 0 });

    const infos: string[] = [];
    const res = await superviseLoop({
      repoRoot: fx.repo,
      configDir: fx.configDir,
      tickBudget: 2,
      runTick,
      log: { info: (l) => infos.push(l), warn: () => {}, error: () => {} },
    });

    expect(res.hibernated).toBe(false);
    expect(infos.some((l) => l.includes("reached --max 2"))).toBe(true);
    expect(infos.some((l) => l.includes("friction:"))).toBe(false);
  });
});

/**
 * ABORT-SIGNATURE-NAMES-ITS-STAGE — the abort site holds the aborting
 * streak's stage (`failureStreaks` is keyed `${stage}:${signature}`), so
 * `repeatedFailure` reports it rather than leaving a consumer to read it
 * back out of the signature's wording (`.claude/rules/engineering.md`, *A
 * fact the engine holds is reported, never rediscovered*). The stage rides
 * its own field: the reported `signature` stays the raw comparison key the
 * tick wrote.
 */
describe("superviseLoop — the aborting streak's stage is reported, not inferred (ABORT-SIGNATURE-NAMES-ITS-STAGE)", () => {
  const verdictPath = (phase: string): string =>
    childVerdictPath(join(fx.repo, ".flume"), phase);

  /**
   * How a verdict carries a failure of each stage the roster names — keyed
   * by {@link FailureStage}, so a stage added to {@link FAILURE_STAGES} is a
   * compile error here until this fixture says which list carries it, never
   * a member silently driven as some other stage.
   */
  const verdictCarrying: Record<
    FailureStage,
    (record: { signature: string; message: string }) => Partial<TickVerdict>
  > = {
    provision: (record) => ({ provisionFailures: [record] }),
    render: (record) => ({
      noCommit: "render-refused" as const,
      renderFailures: [record],
    }),
    merge: (record) => ({
      mergeFailures: [{ ...blamedOnFixture("STAGED"), ...record }],
    }),
    gate: (record) => ({
      noCommit: "gate-revert" as const,
      gateFailures: [record],
    }),
    // Always blamed: `shipped` is consulted only for a span that reached
    // trunk, so a `ShipFailure` (`src/tickVerdict.ts`) always names the entry
    // the pick carried.
    ship: (record) => ({
      shipFailures: [{ ...blamedOnFixture("STAGED"), ...record }],
    }),
    // The one member with no blame half to hand it: a preempt's record
    // carries the signature and the message alone (`PlatformFailure`,
    // `src/tickVerdict.ts`), so this arm passes `record` through as the whole
    // thing rather than spreading a tag fixture over it.
    platform: (record) => ({
      noCommit: "platform-preempt" as const,
      platformFailures: [record],
    }),
  };

  /**
   * Drive `abortThreshold` consecutive ticks whose verdict carries exactly
   * one failure, in `stage`'s list, with `signature`. Returns the run's
   * result plus the error lines the supervisor logged.
   */
  async function abortOn(
    stage: FailureStage,
    signature: string,
  ): Promise<{
    res: Awaited<ReturnType<typeof superviseLoop>>;
    errors: string[];
    calls: number;
  }> {
    const baton = new Baton(join(fx.repo, ".flume"));
    baton.wake("build"); // never hibernates — the abort comes from the backstop alone

    const record = { signature, message: signature };
    let calls = 0;
    const runTick = async ({ phase }: TickChildRequest): Promise<{ exitCode: number | null }> => {
      calls++;
      await writeFile(
        verdictPath(phase),
        JSON.stringify(
          verdictFixture({
            committed: false,
            ...verdictCarrying[stage](record),
          }),
        ),
        "utf8",
      );
      return { exitCode: 0 };
    };

    const errors: string[] = [];
    const res = await superviseLoop({
      repoRoot: fx.repo,
      tickBudget: 10,
      runTick,
      log: { info: () => {}, warn: () => {}, error: (l) => errors.push(l) },
    });
    return { res, errors, calls };
  }

  it("superviseLoop reports the aborting streak's stage for every FAILURE_STAGES member", async () => {
    // Every stage the supervisor folds into a streak, each driven through
    // the real abort path — read off the engine's roster, so no member can
    // be left standing in for the rest.
    expect(FAILURE_STAGES.length).toBeGreaterThan(0);
    for (const stage of FAILURE_STAGES) {
      const { res, calls, errors } = await abortOn(
        stage,
        `${stage} wall: EBUSY`,
      );
      expect(calls).toBe(3);
      expect(res.repeatedFailure).toEqual({
        stage,
        signature: `${stage} wall: EBUSY`,
        count: 3,
      });
      // The log line the operator reads names it too, never "provisioning".
      expect(errors.some((e) => e.includes(`${stage}-stage`))).toBe(true);
    }
  });

  it("repeatedFailure.signature carries the raw comparison key with no stage prefix", async () => {
    // A signature that itself contains a colon — the internal streak key is
    // `${stage}:${signature}`, and none of that prefix may reach the field.
    const SIGNATURE = "error: could not apply 4b825dc: conflict in src/a.ts";
    const { res } = await abortOn("merge", SIGNATURE);
    expect(res.repeatedFailure?.count).toBe(3);
    expect(res.repeatedFailure?.signature).toBe(SIGNATURE);
    expect(res.repeatedFailure?.signature.startsWith("merge:")).toBe(false);
  });
});

/**
 * spec/loop.md "Repeated identical failures — quarantine, then abort": the
 * platform stage is the one roster member that reaches the backstop alone. An
 * agent that failed for non-work reasons — an expired login, a spent cap, an
 * OOM kill — records a `PlatformFailure` (`src/tickVerdict.ts`) keyed by its
 * preempt class and blamed on no entry, because the wall belongs to the host
 * rather than to the entry the slot happened to be carrying. So nothing is
 * quarantined, nothing on trunk can lift a hold that was never placed, and the
 * streak is the only thing bounding the burn: without it the class repeated to
 * `--max` at full agent price, every tick, while `noCommit: "platform-preempt"`
 * said so on every verdict.
 *
 * Same `runTick` fixture idiom as the sibling suites: a stub writes the record
 * a real child would, whose own production `tests/Dispatcher.test.ts` proves.
 */
describe("superviseLoop — the platform stage feeds the backstop alone", () => {
  const verdictPath = (phase: string): string =>
    childVerdictPath(join(fx.repo, ".flume"), phase);

  /** The preempt class a spent cap leaves, identical on every tick of the run. */
  const PREEMPT = "exit 1: Credit balance is too low";

  /**
   * A verdict as a preempted tick writes it: nothing committed, the tick-level
   * `noCommit` classing the attempt, and the stage record carrying the class
   * as its comparison key with no entry named. Returned as well as written, so
   * a case can assert the set it judged was populated rather than trusting the
   * stub it just called (`.claude/rules/engineering.md`, *A green verdict is
   * proven non-vacuous*).
   */
  const preemptedVerdict = (): TickVerdict =>
    verdictFixture({
      committed: false,
      noCommit: "platform-preempt",
      platformFailures: [{ signature: PREEMPT, message: PREEMPT }],
    });

  it("the backstop aborts a run whose ticks repeat one platform failure class", async () => {
    const baton = new Baton(join(fx.repo, ".flume"));
    baton.wake("build"); // never hibernates — the abort must come from the backstop alone

    let calls = 0;
    const runTick = async ({
      phase,
    }: TickChildRequest): Promise<{ exitCode: number | null }> => {
      calls++;
      await writeFile(
        verdictPath(phase),
        JSON.stringify(preemptedVerdict()),
        "utf8",
      );
      return { exitCode: 0 };
    };

    const errors: string[] = [];
    const res = await superviseLoop({
      repoRoot: fx.repo,
      tickBudget: 10,
      runTick,
      log: { info: () => {}, warn: () => {}, error: (l) => errors.push(l) },
    });

    // The budget was 10 and the streak stopped it at 3: the seven ticks the
    // run did not spend are what this leg buys.
    expect(calls).toBe(3);
    expect(res.ticks).toBe(3);
    expect(res.hibernated).toBe(false);
    expect(res.repeatedFailure).toEqual({
      stage: "platform",
      signature: PREEMPT,
      count: 3,
    });
    expect(
      errors.some((e) => e.includes("platform-stage") && e.includes(PREEMPT)),
    ).toBe(true);
    // Every tick that ran is an errored tick in the run's own accounting, so
    // the abort is not the only place the class is visible.
    expect(res.erroredTicks).toHaveLength(3);
  });

  it("a repeated platform failure quarantines no entry", async () => {
    const baton = new Baton(join(fx.repo, ".flume"));
    baton.wake("build");

    const receivedSlugs: Array<string[]> = [];
    const written: TickVerdict[] = [];
    let calls = 0;
    const runTick = async ({
      phase,
      quarantinedSlugs,
    }: TickChildRequest): Promise<{ exitCode: number | null }> => {
      calls++;
      receivedSlugs.push([...quarantinedSlugs].sort());
      const verdict = preemptedVerdict();
      written.push(verdict);
      await writeFile(verdictPath(phase), JSON.stringify(verdict), "utf8");
      // Two ticks, one short of the threshold: the run ends on the baton, so
      // what the second child was handed is read rather than lost to an abort.
      if (calls >= 2) baton.sleep("build");
      return { exitCode: 0 };
    };

    const warnings: string[] = [];
    const res = await superviseLoop({
      repoRoot: fx.repo,
      tickBudget: 10,
      runTick,
      log: { info: () => {}, warn: (l) => warnings.push(l), error: () => {} },
    });

    expect(res.ticks).toBe(2);
    expect(res.hibernated).toBe(true);
    expect(res.repeatedFailure).toBeUndefined();

    // Vacuity pin: the failure this case is about was on every verdict the
    // supervisor read, so the empty quarantine below is a hold declined
    // rather than a record that never arrived.
    expect(written).toHaveLength(2);
    for (const verdict of written) {
      expect(verdict.platformFailures ?? []).toHaveLength(1);
    }

    // The second child is the one that would have carried a hold placed by
    // the first, and it was handed nothing.
    expect(receivedSlugs).toEqual([[], []]);
    expect(warnings.some((w) => w.includes("quarantining"))).toBe(false);
  });
});


/**
 * spec/loop.md "Repeated identical failures — quarantine, then abort": the
 * ship stage is the chain's own `shipped` hook throwing for one entry, as a
 * thrown `promptArgs` is at the render stage. A predicate that throws
 * deterministically throws again on the next wave, so without this record the
 * entry was re-picked, re-provisioned, re-agented and re-picked to `--max`,
 * while every verdict already carried the throw on the entry's merge outcome.
 *
 * The blamed half is always filled — `shipped` is consulted only for a span
 * that reached trunk — so both legs reach this stage: the entry is
 * quarantined, and the signature joins the streak. A `shipped` that *returned*
 * `false` records nothing: a declined ship is the chain's verdict on a landed
 * commit, not a failure.
 *
 * Same `runTick` fixture idiom as the sibling suites: a stub writes the
 * records a real child would, whose own production `tests/Dispatcher.test.ts`
 * proves.
 */
describe("superviseLoop — a `shipped` hook that threw is a ship-stage failure", () => {
  const verdictPath = (phase: string): string =>
    childVerdictPath(join(fx.repo, ".flume"), phase);

  /** The message the chain's broken predicate throws, identically every wave. */
  const THROWN = "shipped hook threw: Cannot read properties of undefined";

  /**
   * A verdict as a wave whose `shipped` threw for `THROWN-SHIP` writes it: the
   * entry's merge outcome carries the `not-shipped` fate and the thrown
   * message, and the stage record beside it carries the blame pair and the
   * comparison key. A sibling entry whose predicate deliberately returned
   * `false` rides along, so every case here reads a verdict where the two
   * causes of one `not-shipped` are both present and only one of them is a
   * failure.
   */
  const threwVerdict = (): TickVerdict =>
    verdictFixture({
      committed: false,
      tags: ["THROWN-SHIP", "DECLINED-SHIP"],
      mergeOutcomes: [
        {
          entryTag: "THROWN-SHIP",
          outcome: "not-shipped",
          threw: THROWN,
        },
        { entryTag: "DECLINED-SHIP", outcome: "not-shipped" },
      ],
      shipFailures: [
        { ...blamedOnFixture("THROWN-SHIP"), signature: THROWN, message: THROWN },
      ],
    });

  it("the backstop aborts a run whose ticks repeat one ship-stage failure signature", async () => {
    const baton = new Baton(join(fx.repo, ".flume"));
    baton.wake("build"); // never hibernates — the abort must come from the backstop alone

    const written: TickVerdict[] = [];
    let calls = 0;
    const runTick = async ({
      phase,
    }: TickChildRequest): Promise<{ exitCode: number | null }> => {
      calls++;
      const verdict = threwVerdict();
      written.push(verdict);
      await writeFile(verdictPath(phase), JSON.stringify(verdict), "utf8");
      return { exitCode: 0 };
    };

    const errors: string[] = [];
    const res = await superviseLoop({
      repoRoot: fx.repo,
      tickBudget: 10,
      runTick,
      log: { info: () => {}, warn: () => {}, error: (l) => errors.push(l) },
    });

    // The budget was 10 and the streak stopped it at 3: the seven ticks the
    // run did not spend at full agent price are what this leg buys.
    expect(calls).toBe(3);
    expect(res.ticks).toBe(3);
    expect(res.hibernated).toBe(false);
    expect(res.repeatedFailure).toEqual({
      stage: "ship",
      signature: THROWN,
      count: 3,
    });
    expect(
      errors.some((e) => e.includes("ship-stage") && e.includes(THROWN)),
    ).toBe(true);

    // Vacuity pin: every tick the streak counted carried exactly the one
    // ship-stage record, beside the declined sibling that contributed none
    // (`.claude/rules/engineering.md`, *A green verdict is proven
    // non-vacuous*).
    expect(written).toHaveLength(3);
    for (const verdict of written) {
      expect(verdict.shipFailures ?? []).toHaveLength(1);
      expect(verdict.mergeOutcomes).toHaveLength(2);
    }

    // The run's own accounting names the throw and the entry it was blamed
    // on, rather than reporting a tick that merely committed nothing.
    expect(res.erroredTicks).toHaveLength(3);
    expect(res.erroredTicks[0]).toContain("shipped predicate threw");
    expect(res.erroredTicks[0]).toContain("THROWN-SHIP");
  });

  it("a repeated ship-hook throw quarantines the entry its merge outcome blamed", async () => {
    const baton = new Baton(join(fx.repo, ".flume"));
    baton.wake("build");

    const receivedSlugs: Array<string[]> = [];
    const written: TickVerdict[] = [];
    let calls = 0;
    const runTick = async ({
      phase,
      quarantinedSlugs,
    }: TickChildRequest): Promise<{ exitCode: number | null }> => {
      calls++;
      receivedSlugs.push([...quarantinedSlugs].sort());
      const verdict = threwVerdict();
      written.push(verdict);
      await writeFile(verdictPath(phase), JSON.stringify(verdict), "utf8");
      // Two ticks, one short of the threshold: the run ends on the baton, so
      // what the second child was handed is read rather than lost to an abort.
      if (calls >= 2) baton.sleep("build");
      return { exitCode: 0 };
    };

    const warnings: string[] = [];
    const res = await superviseLoop({
      repoRoot: fx.repo,
      tickBudget: 10,
      runTick,
      log: { info: () => {}, warn: (l) => warnings.push(l), error: () => {} },
    });

    expect(res.ticks).toBe(2);
    expect(res.repeatedFailure).toBeUndefined();

    // Vacuity pin: both verdicts carried the record the hold is keyed from,
    // and the tip never moved, so the hold below stands rather than having
    // been lifted by a tip this stub advanced.
    expect(written).toHaveLength(2);
    for (const verdict of written) {
      expect(verdict.shipFailures ?? []).toHaveLength(1);
    }
    expect(new Set(written.map((v) => v.headSha)).size).toBe(1);

    // The second child carries the hold the first tick placed, under the key
    // that tick reported — and carries nothing for the sibling whose
    // predicate deliberately returned `false`.
    expect(receivedSlugs).toEqual([[], ["thrown-ship@00112233aa"]]);
    expect(
      warnings.some(
        (w) =>
          w.includes("quarantining THROWN-SHIP") &&
          w.includes("ship-stage failure"),
      ),
    ).toBe(true);
    expect(warnings.some((w) => w.includes("DECLINED-SHIP"))).toBe(false);
  });
});


/**
 * spec/loop.md "Exit codes — the run never lies to CI": what a run cost is
 * read where its outcome is. The rows already exist — every agent invocation
 * leaves one on its tick's verdict — so the run-level total is a fold over
 * this run's verdicts, never a re-read of the verdict log's history.
 *
 * An agreement gate in the same shape as the exit-code suites: the real
 * `superviseLoop` accumulates and the real `loopCompletionSummary`
 * (`src/cliVerdict.ts`) renders what it accumulated, so a one-sided change to
 * either cannot ship green (`.claude/rules/engineering.md`, *A seam gate
 * reads what the real writer wrote*).
 */
describe("superviseLoop — the run's agent spend, by phase", () => {
  /**
   * One usage row as a real tick writes it. `promptPath` and
   * `uncommittedTracked` are the row's non-usage fields, present on every
   * row by contract; the usage facts themselves are absent per field when
   * the agent did not report them, which is what the sparse row below
   * exercises.
   */
  const usageRow = (
    over: Partial<TickVerdictInvocation>,
  ): TickVerdictInvocation => ({
    promptPath: "prompts/tick.md",
    uncommittedTracked: [],
    ...over,
  });

  it("the completion summary totals the run's agent usage by phase", async () => {
    const baton = new Baton(join(fx.repo, ".flume"));
    baton.wake("build");
    const verdictPath = childVerdictPath(join(fx.repo, ".flume"), "build");

    // Three ticks across two phases: a singleton plan tick, a build wave
    // whose two provisioned entries each left a row, and a second build tick
    // whose row reports only what its agent happened to report — so the
    // build total proves both across-rows and across-ticks accumulation, and
    // an absent field adding zero rather than poisoning the sum.
    //
    // One awake phase drives all three, so the `plan` verdict below is left
    // at the build child's own path: the subject here is the fold over each
    // verdict's `phaseName`, not which file it was read from, and a second
    // awake phase would make the three ticks' order the race it is not.
    const ticks: TickVerdict[] = [
      verdictFixture({
        phaseName: "plan",
        invocations: [
          usageRow({
            turns: 2,
            durationMs: 1500,
            inputTokens: 100,
            outputTokens: 10,
            cacheCreationInputTokens: 5,
            cacheReadInputTokens: 50,
            costUsd: 0.25,
          }),
        ],
      }),
      verdictFixture({
        phaseName: "build",
        invocations: [
          usageRow({
            entryTag: "ENTRY-ONE",
            turns: 3,
            durationMs: 2000,
            inputTokens: 200,
            outputTokens: 20,
            cacheCreationInputTokens: 6,
            cacheReadInputTokens: 60,
            costUsd: 0.5,
          }),
          usageRow({
            entryTag: "ENTRY-TWO",
            turns: 4,
            durationMs: 2500,
            inputTokens: 300,
            outputTokens: 30,
            cacheCreationInputTokens: 7,
            cacheReadInputTokens: 70,
            costUsd: 0.75,
          }),
        ],
      }),
      verdictFixture({
        phaseName: "build",
        invocations: [
          usageRow({ entryTag: "ENTRY-THREE", inputTokens: 400, costUsd: 1 }),
        ],
      }),
    ];
    // The subject is populated: a run folding zero rows would agree with
    // almost any total below.
    expect(ticks.flatMap((v) => v.invocations)).toHaveLength(4);

    let call = 0;
    const runTick = async (): Promise<{ exitCode: number | null }> => {
      const verdict = ticks[call++]!;
      await writeFile(verdictPath, JSON.stringify(verdict), "utf8");
      if (call === ticks.length) baton.sleep("build");
      return { exitCode: 0 };
    };

    const res = await superviseLoop({
      repoRoot: fx.repo,
      tickBudget: 5,
      runTick,
      log: silent,
    });

    expect(res.ticks).toBe(3);
    // Per phase, in the order each phase first invoked an agent — the build
    // row is its three invocations summed across two ticks.
    expect(res.agentUsageByPhase).toEqual([
      {
        phase: "plan",
        invocations: 1,
        turns: 2,
        durationMs: 1500,
        inputTokens: 100,
        outputTokens: 10,
        cacheCreationInputTokens: 5,
        cacheReadInputTokens: 50,
        costUsd: 0.25,
      },
      {
        phase: "build",
        invocations: 3,
        turns: 7,
        durationMs: 4500,
        inputTokens: 900,
        outputTokens: 50,
        cacheCreationInputTokens: 13,
        cacheReadInputTokens: 130,
        costUsd: 2.25,
      },
    ]);
    // ...and the line the operator reads is those totals, whole, behind the
    // yield they are read against: the run errored nothing and stopped on
    // hibernation, and none of its three ticks shipped, so the summary is
    // that emptiness spelled out and then the spend.
    expect(loopCompletionSummary(res)).toBe(
      "[flume] shipped nothing | agent usage: " +
        "plan ×1 (2 turns, 1.5s, 100 in / 10 out tokens, " +
        "5 cache-write / 50 cache-read, $0.2500); " +
        "build ×3 (7 turns, 4.5s, 900 in / 50 out tokens, " +
        "13 cache-write / 130 cache-read, $2.2500)",
    );
  });

  /**
   * Vacuous-by-design is spelled, never inherited
   * (`.claude/rules/engineering.md`, *A green verdict is proven
   * non-vacuous*): a tick that invoked no agent leaves no row, and the phase
   * is then absent from the totals rather than present at zero spend. The
   * run below still errors, so the summary renders — the assertion is that
   * the rendered line carries the error and nothing else, not that no line
   * was written at all.
   */
  it("a run whose ticks left no usage row totals nothing in the completion summary", async () => {
    const baton = new Baton(join(fx.repo, ".flume"));
    baton.wake("build");
    const verdictPath = childVerdictPath(join(fx.repo, ".flume"), "build");

    const verdict = verdictFixture({
      committed: false,
      noCommit: "gate-revert",
      invocations: [],
      summary: "build: no commit (gate-revert) → hibernate",
    });
    expect(verdict.invocations).toHaveLength(0);

    const runTick = async (): Promise<{ exitCode: number | null }> => {
      await writeFile(verdictPath, JSON.stringify(verdict), "utf8");
      baton.sleep("build");
      return { exitCode: 0 };
    };

    const res = await superviseLoop({
      repoRoot: fx.repo,
      tickBudget: 5,
      runTick,
      log: silent,
    });

    expect(res.ticks).toBe(1);
    expect(res.agentUsageByPhase).toEqual([]);
    expect(loopCompletionSummary(res)).toBe(
      "[flume] shipped nothing | " +
        "1 tick(s) errored: build: no commit (gate-revert) → hibernate",
    );
  });
});

/**
 * The child table (spec/loop.md, *Baton — presence wakes, absence
 * hibernates*): one child per awake phase that has none of its own in flight,
 * started in the chain's declared order, up to `supervisorPolicy.maxTicks` at
 * once. Every case here drives the real `superviseLoop` through the same
 * stubbed-`runTick` seam the suites above use; what is new is that several
 * calls can be outstanding at once, so each stub says when it started and
 * when it finished rather than being counted.
 *
 * `settle()` below is the negative half of each case — "and then nothing
 * else happened". It is a fixed wait because what it waits for is an absence,
 * and `waitFor` (`tests/helpers/waitFor.ts`) ends on an event: every case
 * pairs it with an event-based wait for the thing that *did* happen, so the
 * fixed wait is never what a positive assertion rests on.
 */
describe("superviseLoop — the child table, one child per awake phase", () => {
  const settle = (): Promise<void> =>
    new Promise((resolve) => setTimeout(resolve, 50));

  /** A promise the case resolves by hand, standing in for a long child tick. */
  function gate(): { held: Promise<void>; release: () => void } {
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    return { held, release };
  }

  it("the supervisor starts one child per awake phase up to supervisorPolicy.maxTicks", async () => {
    const baton = new Baton(join(fx.repo, ".flume"));
    for (const phase of ["alpha", "beta", "gamma"]) baton.wake(phase);

    const started: string[] = [];
    const { held, release } = gate();
    const runTick = async ({
      phase,
    }: TickChildRequest): Promise<{ exitCode: number | null }> => {
      started.push(phase);
      await held;
      baton.sleep(phase);
      return { exitCode: 0 };
    };

    // Declared order is deliberately not the baton's own name order: the
    // flags sort alpha, beta, gamma, and the chain declares gamma first. A
    // supervisor reading the flags for priority would start the wrong two.
    const run = superviseLoop({
      repoRoot: fx.repo,
      tickBudget: 10,
      maxTicks: 2,
      phaseOrder: ["gamma", "alpha", "beta"],
      runTick,
      log: silent,
    });

    await waitFor("the supervisor's first two children", () =>
      started.length >= 2 ? started.length : undefined,
    );
    // Two seats, three flags: the third phase waits for a seat rather than
    // getting a child of its own.
    await settle();
    expect(started).toEqual(["gamma", "alpha"]);

    release();
    const res = await run;

    expect(started).toEqual(["gamma", "alpha", "beta"]);
    expect(res.ticks).toBe(3);
    expect(res.hibernated).toBe(true);
  });

  it("a phase whose child is in flight gets no second child while its flag stands", async () => {
    const baton = new Baton(join(fx.repo, ".flume"));
    baton.wake("slow");
    baton.wake("quick");

    const started: string[] = [];
    const { held, release } = gate();
    const runTick = async ({
      phase,
    }: TickChildRequest): Promise<{ exitCode: number | null }> => {
      started.push(phase);
      // `slow`'s flag stands for the whole of its child's life — the shape a
      // wake landing mid-tick leaves, which is a re-run queued, not a second
      // worker.
      if (phase === "slow") await held;
      else baton.sleep(phase);
      return { exitCode: 0 };
    };

    const run = superviseLoop({
      repoRoot: fx.repo,
      tickBudget: 10,
      maxTicks: 3,
      phaseOrder: ["slow", "quick"],
      runTick,
      log: silent,
    });

    // `quick` has come and gone, so the table holds one child in three
    // seats and `slow`'s flag is standing.
    await waitFor("the quick phase's child to sleep its flag", () =>
      baton.isAwake("quick") ? undefined : true,
    );
    await settle();
    expect(started).toEqual(["slow", "quick"]);
    expect(baton.isAwake("slow")).toBe(true);

    release();
    baton.sleep("slow");
    const res = await run;

    expect(started).toEqual(["slow", "quick"]);
    expect(res.ticks).toBe(2);
  });

  it("the run ends only once no flag stands and no child is in flight", async () => {
    const baton = new Baton(join(fx.repo, ".flume"));
    baton.wake("first");
    baton.wake("second");

    const started: string[] = [];
    const finished: string[] = [];
    const { held, release } = gate();
    const runTick = async ({
      phase,
    }: TickChildRequest): Promise<{ exitCode: number | null }> => {
      started.push(phase);
      if (phase === "second") {
        await held;
        // This child's handoff wakes a successor on its way out, so a flag
        // stands again at the moment its table seat frees.
        baton.wake("third");
      }
      baton.sleep(phase);
      finished.push(phase);
      return { exitCode: 0 };
    };

    const run = superviseLoop({
      repoRoot: fx.repo,
      tickBudget: 10,
      maxTicks: 2,
      phaseOrder: ["first", "second", "third"],
      runTick,
      log: silent,
    });

    // `first` is done and its flag is gone; `second` is still in flight. One
    // half of the end condition holds and the run is still going.
    await waitFor("the first phase's child to finish", () =>
      finished.includes("first") ? true : undefined,
    );
    await settle();
    expect(finished).toEqual(["first"]);

    release();
    const res = await run;

    // And the other half on its own does not end it either: `second` exited
    // into an empty table, but its handoff had left `third` awake.
    expect(started).toEqual(["first", "second", "third"]);
    expect(res.ticks).toBe(3);
    expect(res.hibernated).toBe(true);
    expect(baton.awake()).toEqual([]);
  });

  it("the stop flag starts no new child and lets every in-flight tick finish", async () => {
    const flumeDir = join(fx.repo, ".flume");
    const baton = new Baton(flumeDir);
    for (const phase of ["alpha", "beta", "gamma"]) baton.wake(phase);

    const started: string[] = [];
    const finished: string[] = [];
    const { held, release } = gate();
    const runTick = async ({
      phase,
    }: TickChildRequest): Promise<{ exitCode: number | null }> => {
      started.push(phase);
      // The operator's stop lands while both children are still running.
      if (phase === "alpha") await writeFile(join(flumeDir, "stop"), "", "utf8");
      else await held;
      baton.sleep(phase);
      finished.push(phase);
      return { exitCode: 0 };
    };

    const run = superviseLoop({
      repoRoot: fx.repo,
      tickBudget: 10,
      maxTicks: 2,
      phaseOrder: ["alpha", "beta", "gamma"],
      runTick,
      log: silent,
    });

    await waitFor("the alpha child to finish", () =>
      finished.includes("alpha") ? true : undefined,
    );
    // `gamma` is awake and a seat is free, and still nothing started.
    await settle();
    expect(started).toEqual(["alpha", "beta"]);

    release();
    const res = await run;

    // `beta` ran to its own end rather than being cut short, and the run
    // resolved only after it had.
    expect([...finished].sort()).toEqual(["alpha", "beta"]);
    expect(started).toEqual(["alpha", "beta"]);
    expect(res.ticks).toBe(2);
    expect(res.stoppedByFlag).toBe(true);
    // A stop is not a hibernation: `gamma`'s flag is still standing.
    expect(res.hibernated).toBe(false);
    expect(baton.awake()).toEqual(["gamma"]);
  });

  it("each child is told its phase", async () => {
    const baton = new Baton(join(fx.repo, ".flume"));
    baton.wake("plan");
    baton.wake("build");

    const told: string[] = [];
    const runTick = async ({
      phase,
    }: TickChildRequest): Promise<{ exitCode: number | null }> => {
      told.push(phase);
      baton.sleep(phase);
      return { exitCode: 0 };
    };

    const res = await superviseLoop({
      repoRoot: fx.repo,
      tickBudget: 10,
      maxTicks: 2,
      phaseOrder: ["build", "plan"],
      runTick,
      log: silent,
    });

    // Every child was told a phase the chain declares, in declared order —
    // and the run really started children rather than reporting an empty
    // table (`.claude/rules/engineering.md`, *A green verdict is proven
    // non-vacuous*).
    expect(told).toEqual(["build", "plan"]);
    expect(res.ticks).toBe(2);
    expect(res.hibernated).toBe(true);
  });

  it("a flag naming a phase the chain never declares ends the run as a terminal misconfiguration, after the declared phases have run", async () => {
    const baton = new Baton(join(fx.repo, ".flume"));
    baton.wake("build");
    baton.wake("ghost");

    const started: string[] = [];
    const runTick = async ({
      phase,
    }: TickChildRequest): Promise<{ exitCode: number | null }> => {
      started.push(phase);
      baton.sleep(phase);
      return { exitCode: 0 };
    };

    const res = await superviseLoop({
      repoRoot: fx.repo,
      tickBudget: 10,
      maxTicks: 2,
      phaseOrder: ["build"],
      runTick,
      log: silent,
    });

    // `build` really ran — the orphan verdict is what is left once the work
    // the chain does declare is done, never a refusal that skipped it.
    expect(started).toEqual(["build"]);
    expect(res.ticks).toBe(1);
    // And the orphan is named rather than read as hibernation: a flag is
    // standing that no child of this chain can ever answer.
    expect(res.hibernated).toBe(false);
    expect(res.terminal).toEqual({ kind: "orphaned-awake", phases: ["ghost"] });
    expect(baton.awake()).toEqual(["ghost"]);
  });

  it("a chain that failed to resolve for the supervisor ends the run mount-dead before any child, over an empty baton and a full one alike", async () => {
    const baton = new Baton(join(fx.repo, ".flume"));
    const errors: string[] = [];
    const rec: Logger = {
      info: () => {},
      warn: () => {},
      error: (line) => errors.push(line),
    };

    let calls = 0;
    const runTick = async (): Promise<{ exitCode: number | null }> => {
      calls++;
      return { exitCode: 0 };
    };

    const run = (): Promise<SuperviseResult> =>
      superviseLoop({
        repoRoot: fx.repo,
        tickBudget: 10,
        runTick,
        chainUnresolved: new Error("simulated broken chain.ts"),
        log: rec,
      });

    // The empty baton is the arm that needs this: with nothing awake there
    // is no child to spawn, so a supervisor waiting to be told by one would
    // report the broken chain as a clean hibernation.
    const quiet = await run();
    expect(quiet.mountDead).toBe(true);
    expect(quiet.hibernated).toBe(false);
    expect(quiet.ticks).toBe(0);

    // And the full baton takes the same verdict, rather than spending a
    // child on a chain the supervisor already failed to load.
    baton.wake("build");
    const busy = await run();
    expect(busy.mountDead).toBe(true);
    expect(busy.ticks).toBe(0);
    expect(baton.isAwake("build")).toBe(true);

    // No child either way, and the chain's own failure is what the operator
    // is told — not a class name they would have to reproduce.
    expect(calls).toBe(0);
    expect(
      errors.filter((e) => /simulated broken chain\.ts/.test(e)),
    ).toHaveLength(2);
  });

  it("an undeclared supervisorPolicy.maxTicks runs one child at a time", async () => {
    const baton = new Baton(join(fx.repo, ".flume"));
    baton.wake("alpha");
    baton.wake("beta");

    let live = 0;
    let mostAtOnce = 0;
    let calls = 0;
    // No phase read here on purpose: the property is the width of the table,
    // and a stub that took its phase from the request would be asserting the
    // seam beside it.
    const runTick = async (): Promise<{ exitCode: number | null }> => {
      live++;
      mostAtOnce = Math.max(mostAtOnce, live);
      calls++;
      await new Promise((resolve) => setTimeout(resolve, 10));
      if (calls >= 2) {
        baton.sleep("alpha");
        baton.sleep("beta");
      }
      live--;
      return { exitCode: 0 };
    };

    const res = await superviseLoop({
      repoRoot: fx.repo,
      tickBudget: 10,
      runTick,
      log: silent,
    });

    // Vacuity: two flags stood and the run started a child for each, so
    // "never two at once" is a serial loop rather than a run that only ever
    // had one child to hold.
    expect(calls).toBeGreaterThan(1);
    expect(mostAtOnce).toBe(1);
    expect(res.hibernated).toBe(true);
  });
});

/**
 * spec/loop.md "Crash equals stop", *A run records how it ended*: every end the
 * supervisor reaches leaves `<flumeDir>/run-end.json` behind, naming the reason
 * it ended under.
 *
 * Driven writer-to-reader: the real `superviseLoop` ends the run and the real
 * `readRunEnd` (`src/runEnd.ts`) decodes what it wrote, so neither side of the
 * record is this suite's own vocabulary (`.claude/rules/engineering.md`, *A seam
 * gate reads what the real writer wrote*). Each case asserts the end it is about
 * on the `SuperviseResult` first: a reason read off a record over a run that
 * ended some other way would be green for the wrong end.
 */
describe("superviseLoop — a run records how it ended", () => {
  /**
   * The record the run just wrote, through the real reader, with the window it
   * must have been stamped inside already checked — so each case below asserts
   * the reason and nothing it would have had to restate.
   */
  const recordedEnd = (flumeDir: string, since: number): RunEndRecord => {
    const read = readRunEnd(flumeDir);
    expect(read.kind).toBe("read");
    // The accessor's path, not a spelling repeated here: the reader took its
    // own, and this is the pin that it is the one the state root states.
    expect(existsSync(runEndPath(flumeDir))).toBe(true);
    if (read.kind !== "read") throw new Error("unreachable: asserted above");
    const at = Date.parse(read.record.at);
    expect(at).toBeGreaterThanOrEqual(since - 1_000);
    expect(at).toBeLessThanOrEqual(Date.now() + 1_000);
    return read.record;
  };

  it("the supervisor writes run-end.json naming hibernation as the reason it ended", async () => {
    const flumeDir = join(fx.repo, ".flume");
    const baton = new Baton(flumeDir);
    baton.wake("plan");
    let calls = 0;
    const runTick = (): Promise<{ exitCode: number | null }> => {
      calls++;
      if (calls >= 2) baton.sleep("plan");
      return Promise.resolve({ exitCode: 0 });
    };

    const since = Date.now();
    const res = await superviseLoop({
      repoRoot: fx.repo,
      tickBudget: 50,
      runTick,
      log: silent,
    });

    // The end under test: the baton emptied, inside the budget.
    expect(res.hibernated).toBe(true);
    expect(res.ticks).toBe(2);
    const record = recordedEnd(flumeDir, since);
    expect(record.reason).toBe("hibernation");
    // Neither identifier belongs to this end: no signal arrived and no child's
    // exit decided it, so the record claims neither.
    expect(record.signal).toBeUndefined();
    expect(record.tickExitCode).toBeUndefined();
  });

  it("a run ended by the stop flag records the stop flag as its reason", async () => {
    const flumeDir = join(fx.repo, ".flume");
    const baton = new Baton(flumeDir);
    baton.wake("plan"); // never slept — only the flag can end this run
    let calls = 0;
    const runTick = async (): Promise<{ exitCode: number | null }> => {
      calls++;
      // The operator's `flume stop`, landing while the first tick runs.
      await writeFile(stopFlagPath(flumeDir), "");
      return { exitCode: 0 };
    };

    const since = Date.now();
    const res = await superviseLoop({
      repoRoot: fx.repo,
      tickBudget: 50,
      runTick,
      log: silent,
    });

    // The end under test, and not the budget or hibernation: one tick ran, the
    // flag ended the run, and the baton still carries its flag.
    expect(calls).toBe(1);
    expect(res.stoppedByFlag).toBe(true);
    expect(res.hibernated).toBe(false);
    expect(recordedEnd(flumeDir, since).reason).toBe("stop-flag");
  });

  it("a run ended by the tick budget records the budget as its reason", async () => {
    const flumeDir = join(fx.repo, ".flume");
    new Baton(flumeDir).wake("plan"); // never slept → never hibernates
    let calls = 0;
    const runTick = (): Promise<{ exitCode: number | null }> => {
      calls++;
      return Promise.resolve({ exitCode: 0 });
    };

    const since = Date.now();
    const res = await superviseLoop({
      repoRoot: fx.repo,
      tickBudget: 3,
      runTick,
      log: silent,
    });

    // The end under test: the budget was spent, with a flag still standing.
    expect(calls).toBe(3);
    expect(res.ticks).toBe(3);
    expect(res.hibernated).toBe(false);
    expect(res.stoppedByFlag).toBeUndefined();
    expect(recordedEnd(flumeDir, since).reason).toBe("tick-budget");
  });

  it("a run ended by a signal records the signal", async () => {
    const flumeDir = join(fx.repo, ".flume");
    new Baton(flumeDir).wake("build"); // never slept → only the signal ends this
    const stop = new AbortController();
    const runTick = ({
      stopSignal,
    }: TickChildRequest): Promise<{ exitCode: number | null }> => {
      // The teardown's own abort, carrying the signal it took — the statement
      // the handler makes in production (`src/cliTeardown.ts`).
      stop.abort(signalledStop("SIGTERM"));
      expect(stopSignal.aborted).toBe(true);
      return Promise.resolve({ exitCode: 0 });
    };

    const since = Date.now();
    const res = await superviseLoop({
      repoRoot: fx.repo,
      tickBudget: 5,
      runTick,
      stopSignal: stop.signal,
      log: silent,
    });

    // The end under test: one tick ran, the signal ended the run inside a
    // budget of five, and the baton never emptied.
    expect(res.ticks).toBe(1);
    expect(res.hibernated).toBe(false);
    const record = recordedEnd(flumeDir, since);
    expect(record.reason).toBe("signal");
    expect(record.signal).toBe("SIGTERM");
  });

  it("a run the mount-dead wall ended records the child exit code it fail-fasted on", async () => {
    const flumeDir = join(fx.repo, ".flume");
    new Baton(flumeDir).wake("plan"); // an aborted tick does no baton work
    let calls = 0;
    const runTick = (): Promise<{ exitCode: number | null }> => {
      calls++;
      return Promise.resolve({ exitCode: EX_MOUNT_DEAD });
    };

    const since = Date.now();
    const res = await superviseLoop({
      repoRoot: fx.repo,
      tickBudget: 9,
      runTick,
      log: silent,
    });

    // The end under test: the first mount-dead child ended the run, well
    // inside the budget.
    expect(calls).toBe(1);
    expect(res.mountDead).toBe(true);
    const record = recordedEnd(flumeDir, since);
    expect(record.reason).toBe("mount-dead");
    // The fact this run holds is the child's exit code; the supervisor's own
    // exit is the CLI's to decide after this record is written.
    expect(record.tickExitCode).toBe(EX_MOUNT_DEAD);
  });
});
