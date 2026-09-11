/**
 * `superviseLoop` — the `flume loop` outer supervisor (`src/loopSupervisor.ts`).
 *
 * Moved here with the module when the supervisor left `src/Dispatcher.ts`;
 * the suites are unchanged but for their import paths. Every one of them
 * drives the real `superviseLoop` with a stubbed `runTick` that writes
 * `tick-verdict.json` directly — the child-process seam — rather than running
 * a real wave, whose own mechanism `tests/Dispatcher.test.ts` proves.
 */

import { existsSync } from "node:fs";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { superviseLoop } from "../src/loopSupervisor.ts";
import {
  tickVerdictPath,
  EX_MOUNT_DEAD,
  EX_TERMINAL_MISCONFIG,
  type Logger,
} from "../src/Dispatcher.ts";
import { slugify } from "../src/paths.ts";
import { Baton } from "../src/Baton.ts";
import { loopExitCode } from "../src/cliVerdict.ts";
import {
  makeFixture,
  silent,
  verdictFixture,
  writeMinimalChain,
  type Fixture,
} from "./helpers/dispatcherFixture.ts";

/**
 * The `tag`/`quarantineKey` pair a real tick's stage-failure record carries
 * (`StageFailureEntry`, `src/Dispatcher.ts`). Hand-authored here because the
 * `superviseLoop` suites write `tick-verdict.json` directly rather than
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

describe("superviseLoop — tip-moved counts as errored (RELEASE-v0.11 §5)", () => {
  it("a tip-moved tick is distinguishable in the run's errored-tick classification, even though it is never a NoCommitMode", async () => {
    const baton = new Baton(join(fx.repo, ".flume"));
    baton.wake("build");
    const verdictPath = tickVerdictPath(join(fx.repo, ".flume"));

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
      maxTicks: 5,
      runTick,
      log: silent,
    });

    expect(res.hibernated).toBe(true);
    expect(res.ticks).toBe(1);
    expect(res.erroredTicks).toHaveLength(1);
    expect(res.erroredTicks[0]).toContain("tip-moved");
  });
});

describe("superviseLoop — process-per-tick supervisor (§2)", () => {
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
      maxTicks: 50,
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
      maxTicks: 4,
      runTick,
      log: silent,
    });

    expect(calls).toBe(4);
    expect(res.ticks).toBe(4);
    expect(res.hibernated).toBe(false);
  });

  it("mount-dead: child exits EX_MOUNT_DEAD → supervisor aborts on first occurrence, never burns to --max (v0.7 §4)", async () => {
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
      maxTicks: 3,
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
   * v0.8 §5 — shipped/errored cross the child→supervisor boundary by disk
   * (`<flumeDir>/tick-verdict.json`), not stdio: child stdio stays
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
    const verdictPath = tickVerdictPath(join(fx.repo, ".flume"));

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
      maxTicks: 5,
      runTick,
      log: silent,
    });

    expect(res.hibernated).toBe(true);
    expect(res.ticks).toBe(2);
    expect(res.shippedTags).toEqual(["SHIPPED-ENTRY"]);
    expect(res.erroredTicks).toHaveLength(1);
    expect(res.erroredTicks[0]).toContain("gate-revert");
  });

  it("render-refused (RELEASE-v0.10 §3) counts as errored — a broken prompt is a genuine failure, not a clean-exit no-op", async () => {
    const baton = new Baton(join(fx.repo, ".flume"));
    baton.wake("build");
    const verdictPath = tickVerdictPath(join(fx.repo, ".flume"));

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
      maxTicks: 5,
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
      // No tick-verdict.json write at all — this is the "died before
      // reaching the write" shape the fix targets.
      return { exitCode: 1 };
    };

    const res = await superviseLoop({
      repoRoot: fx.repo,
      maxTicks: 3,
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

  it("fail-fasts on a child's 78: stops after one tick, names the orphaned phases, leaves the flags (§3)", async () => {
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
      maxTicks: 5,
      runTick,
      log: rec,
    });

    // Immediate stop: no further ticks despite --max 5 and a non-empty baton.
    expect(calls).toBe(1);
    expect(res.ticks).toBe(1);
    expect(res.hibernated).toBe(false);
    expect(res.terminal).toEqual({ kind: "orphaned-awake", phases: ["ghost"] });
    expect(
      errors.some((e) => /terminal misconfiguration/.test(e) && /ghost/.test(e)),
    ).toBe(true);
    // The supervisor never clears the flag either — diagnosability over tidiness.
    expect(baton.isAwake("ghost")).toBe(true);
  });
});

/**
 * spec/loop.md "Exit codes — the run never lies to CI": fa03a39 generalized
 * the §16 backstop to the merge stage (`mergeFailures` on the verdict) but
 * left this accounting provision-only — a wave that ships nothing because
 * every entry hit a cherry-pick conflict recorded `mergeFailures` with no
 * `gate-revert`/`platform-preempt`/`render-refused`/`tipMoved` and no
 * `provisionFailures`, so it fell through every leg of the `errored` formula
 * and the run could burn every `--max` tick wedged on merge conflicts while
 * `loopExitCode` still read 0. Sibling coverage to the provisioning-only
 * errored-accounting tests above, same `runTick` fixture idiom.
 */
describe("superviseLoop — merge-stage-only failure counts as errored (loop-merge-failure-errored-accounting)", () => {
  const verdictPath = (): string => tickVerdictPath(join(fx.repo, ".flume"));

  it("a tick recording only mergeFailures with zero shippedTags and no gate revert is counted in erroredTicks", async () => {
    const baton = new Baton(join(fx.repo, ".flume"));
    baton.wake("build");

    const runTick = async (): Promise<{ exitCode: number | null }> => {
      await writeFile(
        verdictPath(),
        JSON.stringify(
          verdictFixture({
            committed: false,
            summary: "build: no commit — merge failed",
            mergeFailures: [
              {
                ...blamedOnFixture("CONFLICT-A"),
                signature: "cherry-pick conflict in src/shared.ts",
                message: "error: could not apply ...: conflict in src/shared.ts",
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
      maxTicks: 5,
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
    // accounting fix from the separate §16 consecutive-identical-signature
    // backstop (which would independently force a non-zero exit at 3).
    let calls = 0;
    const runTick = async (): Promise<{ exitCode: number | null }> => {
      calls++;
      const signature = `cherry-pick conflict in src/file-${calls}.ts`;
      await writeFile(
        verdictPath(),
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
      maxTicks: 3,
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

    const runTick = async (): Promise<{ exitCode: number | null }> => {
      await writeFile(
        verdictPath(),
        JSON.stringify(
          verdictFixture({
            committed: true,
            shippedTags: ["OK-A"],
            summary: "build shipped OK-A",
            mergeFailures: [
              {
                ...blamedOnFixture("CONFLICT-B"),
                signature: "cherry-pick conflict in src/shared.ts",
                message: "error: could not apply ...: conflict in src/shared.ts",
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
      maxTicks: 5,
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
 * v0.7 §16 — the supervisor-level legs `superviseLoop` owns: a tagged
 * provisioning failure quarantines its slug for the rest of the run (and
 * that quarantine crosses to the next child tick via `runTick`'s
 * `quarantinedSlugs` argument, mirroring how the real CLI carries it over
 * `FLUME_QUARANTINED_SLUGS`); the same failure signature repeating on three
 * consecutive ticks with no successful tick between them aborts the run; a
 * signature that stops repeating resets the streak. `runTick` here plays the
 * real child `flume tick` process exactly as the §5 suite above does — it
 * writes `tick-verdict.json` directly rather than exercising a real fanout
 * wave (that mechanism is proved in the `Dispatcher fanout — pre-tick
 * worktree provisioning failure isolates one entry (§16)` suite).
 */
describe("superviseLoop — provisioning-failure quarantine & consecutive-failure abort backstop (§16)", () => {
  const verdictPath = (): string => tickVerdictPath(join(fx.repo, ".flume"));

  it("quarantines a tagged failure after its first tick and carries it to the next child tick", async () => {
    const baton = new Baton(join(fx.repo, ".flume"));
    baton.wake("build");

    const receivedSlugs: Array<string[]> = [];
    let calls = 0;
    const runTick = async (
      quarantinedSlugs: ReadonlySet<string>,
    ): Promise<{ exitCode: number | null }> => {
      calls++;
      receivedSlugs.push([...quarantinedSlugs].sort());
      if (calls === 1) {
        await writeFile(
          verdictPath(),
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
          verdictPath(),
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
      maxTicks: 5,
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
      warnings.some(
        (w) => w.includes("HELD-ENTRY") && w.includes("EBUSY"),
      ),
    ).toBe(true);
  });

  it("aborts after the same untagged signature fails 3 consecutive ticks with no successful tick between", async () => {
    const baton = new Baton(join(fx.repo, ".flume"));
    baton.wake("build"); // never hibernates — the abort must come from the backstop alone

    const SIGNATURE = "git worktree prune: fatal: not a git repository";
    let calls = 0;
    const runTick = async (): Promise<{ exitCode: number | null }> => {
      calls++;
      await writeFile(
        verdictPath(),
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
      maxTicks: 10,
      runTick,
      log,
    });

    // Aborted on the 3rd consecutive occurrence, never burning to --max 10.
    expect(calls).toBe(3);
    expect(res.ticks).toBe(3);
    expect(res.hibernated).toBe(false);
    expect(res.repeatedFailure).toEqual({ signature: SIGNATURE, count: 3 });
    expect(errors.some((e) => e.includes(SIGNATURE))).toBe(true);
  });

  it("aborts on a repeated signature buried behind a varying sibling at index 0 every tick", async () => {
    const baton = new Baton(join(fx.repo, ".flume"));
    baton.wake("build"); // never hibernates — the abort must come from the backstop alone

    const REPEATED_SIGNATURE = "git worktree prune: fatal: not a git repository";
    let calls = 0;
    const runTick = async (): Promise<{ exitCode: number | null }> => {
      calls++;
      await writeFile(
        verdictPath(),
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
      maxTicks: 10,
      runTick,
      log,
    });

    // Aborted on the 3rd consecutive occurrence of the buried signature,
    // never burning to --max 10.
    expect(calls).toBe(3);
    expect(res.ticks).toBe(3);
    expect(res.hibernated).toBe(false);
    expect(res.repeatedFailure).toEqual({
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
    const runTick = async (): Promise<{ exitCode: number | null }> => {
      calls++;
      if (calls === 1 || calls === 3) {
        await writeFile(
          verdictPath(),
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
          verdictPath(),
          JSON.stringify(verdictFixture({ committed: false })),
          "utf8",
        );
      } else {
        await writeFile(
          verdictPath(),
          JSON.stringify(verdictFixture({ committed: false })),
          "utf8",
        );
        baton.sleep("build");
      }
      return { exitCode: 0 };
    };

    const res = await superviseLoop({
      repoRoot: fx.repo,
      maxTicks: 10,
      runTick,
      log: silent,
    });

    expect(calls).toBe(4);
    expect(res.ticks).toBe(4);
    expect(res.hibernated).toBe(true);
    expect(res.repeatedFailure).toBeUndefined();
  });
});

/**
 * spec/loop.md "Repeated identical failures — quarantine, then abort"
 * generalizes both §16 legs past provisioning to the merge and gate stages —
 * sibling coverage to the provision-only suite above, same `runTick` fixture
 * idiom (a stub writing `tick-verdict.json` directly, standing in for a real
 * fanout wave/singleton tick whose own mechanism the Dispatcher-level suites
 * above prove).
 */
describe("superviseLoop — the §16 backstop generalizes to merge- and gate-stage failures", () => {
  const verdictPath = (): string => tickVerdictPath(join(fx.repo, ".flume"));

  it("quarantines a tagged merge-stage failure exactly like a tagged provisioning failure", async () => {
    const baton = new Baton(join(fx.repo, ".flume"));
    baton.wake("build");

    const receivedSlugs: Array<string[]> = [];
    let calls = 0;
    const runTick = async (
      quarantinedSlugs: ReadonlySet<string>,
    ): Promise<{ exitCode: number | null }> => {
      calls++;
      receivedSlugs.push([...quarantinedSlugs].sort());
      if (calls === 1) {
        await writeFile(
          verdictPath(),
          JSON.stringify(
            verdictFixture({
              committed: true,
              shippedTags: ["OK-A"],
              mergeFailures: [
                {
                  ...blamedOnFixture("CONFLICT-B"),
                  signature: "cherry-pick conflict in src/shared.ts",
                  message: "error: could not apply ...: conflict in src/shared.ts",
                },
              ],
            }),
          ),
          "utf8",
        );
      } else {
        await writeFile(
          verdictPath(),
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
      maxTicks: 5,
      runTick,
      log,
    });

    expect(res.hibernated).toBe(true);
    expect(res.ticks).toBe(2);
    expect(res.shippedTags).toEqual(["OK-A"]);
    expect(receivedSlugs[0]).toEqual([]);
    expect(receivedSlugs[1]).toEqual(["conflict-b@00112233aa"]);
    expect(
      warnings.some((w) => w.includes("CONFLICT-B") && w.includes("merge-stage")),
    ).toBe(true);
  });

  it("quarantines a tagged gate-stage failure exactly like a tagged provisioning failure", async () => {
    const baton = new Baton(join(fx.repo, ".flume"));
    baton.wake("build");

    const receivedSlugs: Array<string[]> = [];
    let calls = 0;
    const runTick = async (
      quarantinedSlugs: ReadonlySet<string>,
    ): Promise<{ exitCode: number | null }> => {
      calls++;
      receivedSlugs.push([...quarantinedSlugs].sort());
      if (calls === 1) {
        await writeFile(
          verdictPath(),
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
          verdictPath(),
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
      maxTicks: 5,
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
    const runTick = async (): Promise<{ exitCode: number | null }> => {
      calls++;
      await writeFile(
        verdictPath(),
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
      maxTicks: 10,
      runTick,
      log,
    });

    expect(calls).toBe(3);
    expect(res.ticks).toBe(3);
    expect(res.hibernated).toBe(false);
    // The exposed shape carries the raw signature only — never prefixed with
    // the stage that tagged it internally.
    expect(res.repeatedFailure).toEqual({ signature: SIGNATURE, count: 3 });
    expect(errors.some((e) => e.includes(SIGNATURE))).toBe(true);
  });

  it("aborts after the same untagged gate-stage signature fails 3 consecutive ticks (a singleton's own gate revert has no entry to quarantine)", async () => {
    const baton = new Baton(join(fx.repo, ".flume"));
    baton.wake("plan"); // never hibernates — the abort must come from the backstop alone

    const SIGNATURE = "tsc: no commit — tsc failed";
    let calls = 0;
    const runTick = async (): Promise<{ exitCode: number | null }> => {
      calls++;
      await writeFile(
        verdictPath(),
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
      maxTicks: 10,
      runTick,
      log,
    });

    expect(calls).toBe(3);
    expect(res.ticks).toBe(3);
    expect(res.hibernated).toBe(false);
    expect(res.repeatedFailure).toEqual({ signature: SIGNATURE, count: 3 });
    expect(errors.some((e) => e.includes(SIGNATURE))).toBe(true);
  });

  it("a clean exit never joins the accounting, however many times it repeats", async () => {
    const baton = new Baton(join(fx.repo, ".flume"));
    baton.wake("plan");

    const receivedSlugs: Array<string[]> = [];
    let calls = 0;
    const runTick = async (
      quarantinedSlugs: ReadonlySet<string>,
    ): Promise<{ exitCode: number | null }> => {
      calls++;
      receivedSlugs.push([...quarantinedSlugs].sort());
      await writeFile(
        verdictPath(),
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
      maxTicks: 10,
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
    const runTick = async (): Promise<{ exitCode: number | null }> => {
      calls++;
      if (calls === 1) {
        // Tick 1: a merge-stage failure with the shared text — starts a
        // merge-stage streak of 1.
        await writeFile(
          verdictPath(),
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
          verdictPath(),
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
      maxTicks: 10,
      runTick,
      log: silent,
    });

    // If the merge-stage tick's count had leaked into the gate-stage streak,
    // the abort would fire on tick 3 (1 carried + 2 more = 3) instead of
    // tick 4 (the gate-stage streak's own 3rd occurrence).
    expect(calls).toBe(4);
    expect(res.ticks).toBe(4);
    expect(res.hibernated).toBe(false);
    expect(res.repeatedFailure).toEqual({ signature: SHARED_TEXT, count: 3 });
  });
});

/**
 * v0.8 §8 — `SuperviseLoopOptions.quarantineScope` /
 * `abortThreshold` open the two constants the suite above exercises at
 * their v0.7 §16 defaults (run-scoped quarantine; three-failure abort) as
 * chain-overridable config. The CLI forwards a resolved chain's
 * `supervisorPolicy` block into these same options (`src/cli.ts`); this
 * suite proves `superviseLoop` itself, the same seam the prior suite
 * already proves defaults through when neither option is passed.
 */
describe("superviseLoop — supervisor policy knobs override the §16 defaults (v0.8 §8)", () => {
  const verdictPath = (): string => tickVerdictPath(join(fx.repo, ".flume"));

  it("abortThreshold: 2 aborts on the second consecutive identical signature, not the third", async () => {
    const baton = new Baton(join(fx.repo, ".flume"));
    baton.wake("build");

    const SIGNATURE = "git worktree prune: fatal: not a git repository";
    let calls = 0;
    const runTick = async (): Promise<{ exitCode: number | null }> => {
      calls++;
      await writeFile(
        verdictPath(),
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
      maxTicks: 10,
      runTick,
      log: silent,
      abortThreshold: 2,
    });

    expect(calls).toBe(2);
    expect(res.ticks).toBe(2);
    expect(res.hibernated).toBe(false);
    expect(res.repeatedFailure).toEqual({ signature: SIGNATURE, count: 2 });
  });

  it("quarantineScope: \"none\" never quarantines a tagged failure — later ticks still see the empty set", async () => {
    const baton = new Baton(join(fx.repo, ".flume"));
    baton.wake("build");

    const receivedSlugs: Array<string[]> = [];
    let calls = 0;
    const runTick = async (
      quarantinedSlugs: ReadonlySet<string>,
    ): Promise<{ exitCode: number | null }> => {
      calls++;
      receivedSlugs.push([...quarantinedSlugs].sort());
      if (calls < 3) {
        await writeFile(
          verdictPath(),
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
          verdictPath(),
          JSON.stringify(verdictFixture({ committed: false })),
          "utf8",
        );
        baton.sleep("build");
      }
      return { exitCode: 0 };
    };

    const res = await superviseLoop({
      repoRoot: fx.repo,
      maxTicks: 5,
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

  it("a chain declaring neither knob gets the supervisor-policy defaults, byte-identical", async () => {
    const baton = new Baton(join(fx.repo, ".flume"));
    baton.wake("build");

    const SIGNATURE = "git worktree prune: fatal: not a git repository";
    let calls = 0;
    const runTick = async (): Promise<{ exitCode: number | null }> => {
      calls++;
      await writeFile(
        verdictPath(),
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
      maxTicks: 10,
      runTick,
      log: silent,
    });

    // Undeclared abortThreshold still aborts on the 3rd consecutive tick —
    // the v0.7 §16 default, not the 2 the suite above overrides to.
    expect(calls).toBe(3);
    expect(res.ticks).toBe(3);
    expect(res.repeatedFailure).toEqual({ signature: SIGNATURE, count: 3 });
  });
});

/**
 * §6 (v0.6.2) — `superviseLoop`'s loop-end friction summary
 * (`logFrictionSummary`, `src/loopSupervisor.ts`), and the fix it rode
 * in on: the chain it loads comes from `opts.configDir`, not always
 * `<repoRoot>/.flume` (the old always-used default). `fx.configDir` is a
 * separate temp dir from `fx.repo/.flume` in this suite's fixture, so
 * passing it as `configDir` while leaving `<repoRoot>/.flume` chain-less
 * proves the plumbing: a summary that still finds the chain must have used
 * `opts.configDir`.
 */
describe("superviseLoop — loop-end friction summary (§6) & configDir plumbing", () => {
  it("logs the friction count line at the hibernation stop when declared and non-empty, loading the chain from opts.configDir", async () => {
    // The repo default has no chain.ts at all — only opts.configDir does.
    expect(existsSync(join(fx.repo, ".flume", "chain.ts"))).toBe(false);

    const baton = new Baton(join(fx.repo, ".flume"));
    baton.wake("plan");
    await writeMinimalChain(fx.configDir, JSON.stringify("friction"));
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
      maxTicks: 5,
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
    await writeMinimalChain(fx.configDir, JSON.stringify("friction"));
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
      maxTicks: 5,
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
    await writeMinimalChain(fx.configDir, JSON.stringify("friction"));
    const frictionDir = join(fx.repo, ".flume", "friction");
    await mkdir(frictionDir, { recursive: true });
    await writeFile(join(frictionDir, "a.md"), "note\n");
    // Strip traversal permission: readdir now fails EACCES, not ENOENT
    // (`.claude/rules/engineering.md`, "Loud or nothing").
    await chmod(frictionDir, 0o000);

    let calls = 0;
    const runTick = (): Promise<{ exitCode: number | null }> => {
      calls++;
      if (calls >= 2) baton.sleep("plan");
      return Promise.resolve({ exitCode: 0 });
    };

    const infos: string[] = [];
    try {
      const res = await superviseLoop({
        repoRoot: fx.repo,
        configDir: fx.configDir,
        maxTicks: 5,
        runTick,
        log: { info: (l) => infos.push(l), warn: () => {}, error: () => {} },
      });

      expect(res.hibernated).toBe(true);
      expect(infos.some((l) => l.includes("friction: unreadable"))).toBe(true);
    } finally {
      await chmod(frictionDir, 0o755).catch(() => {});
    }
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
      maxTicks: 5,
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
    await writeMinimalChain(fx.configDir, JSON.stringify("friction"));
    const frictionDir = join(fx.repo, ".flume", "friction");
    await mkdir(frictionDir, { recursive: true });
    await writeFile(join(frictionDir, "a.md"), "note\n");

    const runTick = (): Promise<{ exitCode: number | null }> =>
      Promise.resolve({ exitCode: 0 });

    const infos: string[] = [];
    const res = await superviseLoop({
      repoRoot: fx.repo,
      configDir: fx.configDir,
      maxTicks: 2,
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
    await writeMinimalChain(fx.configDir, JSON.stringify("friction"));
    await mkdir(join(fx.repo, ".flume", "friction"), { recursive: true });

    const runTick = (): Promise<{ exitCode: number | null }> =>
      Promise.resolve({ exitCode: 0 });

    const infos: string[] = [];
    const res = await superviseLoop({
      repoRoot: fx.repo,
      configDir: fx.configDir,
      maxTicks: 2,
      runTick,
      log: { info: (l) => infos.push(l), warn: () => {}, error: () => {} },
    });

    expect(res.hibernated).toBe(false);
    expect(infos.some((l) => l.includes("reached --max 2"))).toBe(true);
    expect(infos.some((l) => l.includes("friction:"))).toBe(false);
  });
});
