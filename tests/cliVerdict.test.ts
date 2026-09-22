/**
 * Tick/loop verdict exit-code + formatting seam — split from
 * tests/cli.test.ts along the same seam as `src/cliVerdict.ts`
 * (`.claude/rules/posture-sweep.md`, "A violation counts only when verified
 * on disk this tick"). Unit-level `tickExitCode`/`loopExitCode`/
 * `loopCompletionSummary` cases plus the real-CLI `flume log` suite, which
 * exercises `formatTickVerdictLine`'s rendering through the CLI read-side.
 */

import { existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import type { TickOutcome } from "../src/Dispatcher.ts";
import { EX_IOERR } from "../src/cli.ts";
import { EX_TERMINAL_MISCONFIG, EX_MOUNT_DEAD } from "../src/exitCodes.ts";
import {
  tickVerdictsLogPath,
  type TickVerdict,
} from "../src/tickVerdict.ts";
import { FAILURE_STAGES } from "../src/loopSupervisor.ts";
import type { SuperviseResult } from "../src/loopSupervisor.ts";
import {
  tickExitCode,
  loopExitCode,
  loopCompletionSummary,
} from "../src/cliVerdict.ts";
import { awakeDir } from "../src/paths.ts";
import { denyFile } from "./helpers/denial.ts";
import { mkTempDir } from "./helpers/fixtureRoot.ts";
import { SPAWN_BUDGET_MS, exec, runCli } from "./helpers/subprocess.ts";

// This file starts processes, so it declares the lane's one budget — cases
// and hooks alike — once here rather than inheriting the runner's default
// (`SPAWN_BUDGET_MS`, `tests/helpers/subprocess.ts`).
vi.setConfig({ testTimeout: SPAWN_BUDGET_MS, hookTimeout: SPAWN_BUDGET_MS });

describe("tickExitCode — axis classification", () => {
  it("terminal misconfiguration → 78 (EX_CONFIG)", () => {
    const outcome: TickOutcome = {
      hibernated: false,
      terminal: { kind: "orphaned-awake", phases: ["ghost"] },
      awakeAfter: ["ghost"],
      summary: "awake flags reference unknown phases: ghost",
    };
    expect(EX_TERMINAL_MISCONFIG).toBe(78);
    expect(tickExitCode(outcome)).toBe(78);
  });

  it("clean hibernation → 0", () => {
    const outcome: TickOutcome = {
      hibernated: true,
      awakeAfter: [],
      summary: "no phases awake; hibernating",
    };
    expect(tickExitCode(outcome)).toBe(0);
  });

  it("mount-dead: chain resolution failure → 69 (EX_UNAVAILABLE)", () => {
    const outcome: TickOutcome = {
      hibernated: false,
      failed: true,
      awakeAfter: ["plan"],
      summary: "chain resolution failed: boom; no work",
    };
    expect(EX_MOUNT_DEAD).toBe(69);
    expect(tickExitCode(outcome)).toBe(EX_MOUNT_DEAD);
  });

  it("ordinary work tick → 0", () => {
    const outcome: TickOutcome = {
      hibernated: false,
      phaseName: "plan",
      awakeAfter: ["build"],
      summary: "plan committed abcd1234 → build",
    };
    expect(tickExitCode(outcome)).toBe(0);
  });

  it("CJS-context usage error → 2, checked ahead of the mount-dead fallback", () => {
    const outcome: TickOutcome = {
      hibernated: false,
      usageError: true,
      awakeAfter: ["plan"],
      summary: '.flume/chain.ts failed to load: ... add "type": "module" ...',
    };
    expect(tickExitCode(outcome)).toBe(2);

    // usageError and failed are documented as mutually exclusive, but the
    // mapping itself must still prefer 2 if both were ever set — a usage
    // refusal is never allowed to collapse back into EX_MOUNT_DEAD.
    const both: TickOutcome = { ...outcome, failed: true };
    expect(tickExitCode(both)).toBe(2);
  });
});

describe("loopExitCode / loopCompletionSummary — amended exit-code contract", () => {
  it("a run with one errored tick and one shipped entry: exits 0, summary names the error", () => {
    const result: SuperviseResult = {
      ticks: 2,
      hibernated: true,
      shippedTags: ["SHIPPED-ENTRY"],
      erroredTicks: ["build: no commit (gate-revert) → hibernate"],
      agentUsageByPhase: [],
    };
    expect(loopExitCode(result)).toBe(0);
    expect(loopCompletionSummary(result)).toContain("SHIPPED-ENTRY");
    expect(loopCompletionSummary(result)).toContain("gate-revert");
  });

  it("at least one errored tick AND nothing shipped → 1", () => {
    const result: SuperviseResult = {
      ticks: 1,
      hibernated: true,
      shippedTags: [],
      erroredTicks: ["plan: no commit (clean-exit) → hibernate"],
      agentUsageByPhase: [],
    };
    expect(loopExitCode(result)).toBe(1);
    expect(loopCompletionSummary(result)).toContain("clean-exit");
  });

  // LOOP-ERRORED-TICKS-SILENT-EXIT: every tick refused before ever writing a
  // verdict (the CJS-context refusal, the detached-HEAD/harness-error
  // refusal, an uncaught throw) — `superviseLoop` now folds these into
  // `erroredTicks` even with nothing on disk to read (Dispatcher.test.ts
  // pins that accumulation). At this seam, the resulting shape — errored
  // ticks present, nothing shipped — must still exit non-zero rather than
  // read as a clean, silent 0.
  it("every tick refused before writing a verdict and nothing shipped → 1", () => {
    const result: SuperviseResult = {
      ticks: 3,
      hibernated: false,
      shippedTags: [],
      erroredTicks: [
        "tick process exited 1 with no verdict written to disk",
        "tick process exited 1 with no verdict written to disk",
        "tick process exited 1 with no verdict written to disk",
      ],
      agentUsageByPhase: [],
    };
    expect(loopExitCode(result)).toBe(1);
    expect(loopCompletionSummary(result)).toContain("3 tick(s) errored");
  });

  it("settled with nothing to do (no errors, nothing shipped) → 0, no completion summary", () => {
    const result: SuperviseResult = {
      ticks: 1,
      hibernated: true,
      shippedTags: [],
      erroredTicks: [],
      agentUsageByPhase: [],
    };
    expect(loopExitCode(result)).toBe(0);
    expect(loopCompletionSummary(result)).toBeUndefined();
  });

  it("terminal misconfiguration propagates 78 regardless of shipped/errored counts", () => {
    const result: SuperviseResult = {
      ticks: 1,
      hibernated: false,
      terminal: { kind: "orphaned-awake", phases: ["ghost"] },
      shippedTags: [],
      erroredTicks: [],
      agentUsageByPhase: [],
    };
    expect(loopExitCode(result)).toBe(EX_TERMINAL_MISCONFIG);
  });

  it("mount-dead propagates 69 regardless of shipped/errored counts", () => {
    const result: SuperviseResult = {
      ticks: 1,
      hibernated: false,
      mountDead: true,
      shippedTags: [],
      erroredTicks: [],
      agentUsageByPhase: [],
    };
    expect(loopExitCode(result)).toBe(EX_MOUNT_DEAD);
  });

  // The consecutive-provisioning-failure abort backstop: non-zero
  // and named in the summary regardless of how much the run shipped before
  // hitting the wall (unlike the plain errored/nothing-shipped rule above).
  it("repeatedFailure aborts non-zero and names the signature, even with entries shipped", () => {
    const result: SuperviseResult = {
      ticks: 3,
      hibernated: false,
      repeatedFailure: {
        stage: "provision",
        signature: "EBUSY: resource busy or locked",
        count: 3,
      },
      shippedTags: ["SHIPPED-BEFORE-THE-WALL"],
      erroredTicks: [],
      agentUsageByPhase: [],
    };
    expect(loopExitCode(result)).toBe(1);
    expect(loopCompletionSummary(result)).toContain(
      "EBUSY: resource busy or locked",
    );
  });

  // The abort threshold is chain-overridable, so the completion
  // summary must name the real streak count, not the literal default 3.
  it("names the real repeatedFailure.count, not a hardcoded 3", () => {
    const result: SuperviseResult = {
      ticks: 2,
      hibernated: false,
      repeatedFailure: {
        stage: "provision",
        signature: "EBUSY: resource busy or locked",
        count: 2,
      },
      shippedTags: [],
      erroredTicks: [],
      agentUsageByPhase: [],
    };
    expect(loopCompletionSummary(result)).toContain("2 consecutive ticks");
    expect(loopCompletionSummary(result)).not.toContain("3 consecutive ticks");
  });

  // ABORT-SIGNATURE-NAMES-ITS-STAGE — the backstop fires on a wall at any
  // stage the roster names, and `superviseLoop` reports which. The summary
  // renders the reported stage; calling every abort a worktree-provisioning
  // failure sent an operator to the wrong stage entirely.
  it("loopCompletionSummary renders every FAILURE_STAGES member as its own stage phrase", () => {
    // The roster the engine exports, never a copy respelled here: a stage
    // added to `FAILURE_STAGES` arrives in this loop with no edit.
    expect(FAILURE_STAGES.length).toBeGreaterThan(0);
    for (const stage of FAILURE_STAGES) {
      const summary = loopCompletionSummary({
        ticks: 3,
        hibernated: false,
        repeatedFailure: { stage, signature: "SIG-" + stage, count: 3 },
        shippedTags: [],
        erroredTicks: [],
        agentUsageByPhase: [],
      });
      expect(summary).toContain(`${stage}-stage failure`);
      expect(summary).toContain("SIG-" + stage);
      expect(summary).not.toContain("worktree provisioning");
    }
  });

  // spec/loop.md "Graceful stop — the stop flag": stop ends iteration, it
  // never reclassifies what already happened — loopExitCode stays decided
  // by the run totals alone, with the completion summary naming the stop
  // flag as the reason iteration ended, even when nothing else went wrong.
  it("a graceful stop with nothing errored/shipped still exits 0, summary names the stop flag", () => {
    const result: SuperviseResult = {
      ticks: 2,
      hibernated: false,
      stoppedByFlag: true,
      shippedTags: [],
      erroredTicks: [],
      agentUsageByPhase: [],
    };
    expect(loopExitCode(result)).toBe(0);
    expect(loopCompletionSummary(result)).toContain("stop flag");
  });

  it("a graceful stop after errored ticks with nothing shipped still exits 1 — no special stop code", () => {
    const result: SuperviseResult = {
      ticks: 2,
      hibernated: false,
      stoppedByFlag: true,
      shippedTags: [],
      erroredTicks: ["build: no commit (gate-revert) → hibernate"],
      agentUsageByPhase: [],
    };
    expect(loopExitCode(result)).toBe(1);
    const summary = loopCompletionSummary(result);
    expect(summary).toContain("stop flag");
    expect(summary).toContain("gate-revert");
  });

  it("a graceful stop with a shipped entry and no errors exits 0, summary still names the stop flag", () => {
    const result: SuperviseResult = {
      ticks: 1,
      hibernated: false,
      stoppedByFlag: true,
      shippedTags: ["SHIPPED-ENTRY"],
      erroredTicks: [],
      agentUsageByPhase: [],
    };
    expect(loopExitCode(result)).toBe(0);
    expect(loopCompletionSummary(result)).toContain("stop flag");
  });
});

// ---------- job resolution through the real CLI ----------

/**
 * Scratch git repo on a chosen branch. The engine has no opinion on branch
 * names — some fixtures below pin `job/foo` merely as a
 * distinctive label, proven inert by running job resolution on `main`
 * instead.
 */
async function makeJobRepo(branch: string): Promise<{
  dir: string;
  cleanup: () => Promise<void>;
}> {
  const dir = await mkTempDir("flume-job-");
  const opts = { cwd: dir };
  await exec("git", ["init", "-q", "-b", branch], opts);
  await exec("git", ["config", "user.email", "test@example.com"], opts);
  await exec("git", ["config", "user.name", "Test User"], opts);
  await exec("git", ["config", "commit.gpgsign", "false"], opts);
  await writeFile(join(dir, "README.md"), "seed\n");
  await exec("git", ["add", "."], opts);
  await exec("git", ["commit", "-q", "-m", "seed"], opts);
  return { dir, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

/**
 * A minimal, otherwise-valid `TickVerdict` — `writeTickVerdict`'s own shape
 * (`src/tickVerdict.ts`), constructed by hand here since `flume log` reads
 * `tick-verdicts.jsonl` directly rather than driving a real tick to produce
 * one (a real tick's plumbing is exercised in Dispatcher.test.ts; this suite
 * holds the CLI read-side alone).
 */
function makeVerdict(
  overrides: Partial<TickVerdict> & { phaseName: string },
): TickVerdict {
  return {
    tags: [],
    committed: false,
    gateResults: [],
    shippedTags: [],
    mergeOutcomes: [],
    invocations: [],
    summary: `${overrides.phaseName} placeholder`,
    headSha: "0".repeat(40),
    at: "2024-01-01T00:00:00.000Z",
    ...overrides,
  };
}

/**
 * Write the verdict history `readTickVerdicts` (`src/tickVerdict.ts`) reads,
 * oldest first, top to bottom. The path comes from the engine's exported
 * {@link tickVerdictsLogPath}, never a filename spelled here: a fixture that
 * re-derives the name reads as a log the CLI never opens the moment the
 * engine renames it.
 */
async function writeTickVerdictsLog(
  root: string,
  verdicts: TickVerdict[],
): Promise<void> {
  const flumeDir = join(root, ".flume");
  await mkdir(flumeDir, { recursive: true });
  await writeFile(
    tickVerdictsLogPath(flumeDir),
    verdicts.map((v) => JSON.stringify(v)).join("\n") + "\n",
    "utf8",
  );
}

describe("flume log (spec/cli.md §Subcommand surface)", () => {
  it("default prints the last 10 verdicts oldest-first as fixed-format lines", async () => {
    const repo = await makeJobRepo("main");
    try {
      const verdicts = Array.from({ length: 12 }, (_, i) =>
        makeVerdict({
          phaseName: `phase-${i}`,
          committed: true,
          gateResults: [{ gate: "tsc", ok: true, message: "" }],
          shippedTags: [`tag-${i}`],
          mergeOutcomes: [{ entryTag: `tag-${i}`, outcome: "merged" }],
        }),
      );
      await writeTickVerdictsLog(repo.dir, verdicts);

      const r = await runCli(repo.dir, ["log"]);
      expect(r.code).toBe(0);
      const lines = r.out.trim().split("\n");
      expect(lines).toHaveLength(10);
      // Last 10 of 12, oldest first — verdicts[2]..verdicts[11] in order.
      for (let i = 0; i < 10; i++) {
        const idx = i + 2;
        expect(lines[i]).toContain(`phase-${idx}`);
        expect(lines[i]).toContain("committed=true");
        expect(lines[i]).toContain("tsc:ok");
        expect(lines[i]).toContain(`tag-${idx}`);
        expect(lines[i]).toContain("merged");
      }
      // The two oldest, dropped by the default cap, never appear.
      expect(r.out).not.toContain("phase-0 ");
      expect(r.out).not.toContain("phase-1 ");
    } finally {
      await repo.cleanup();
    }
  }, SPAWN_BUDGET_MS);

  it("-n N overrides the count", async () => {
    const repo = await makeJobRepo("main");
    try {
      const verdicts = Array.from({ length: 5 }, (_, i) =>
        makeVerdict({ phaseName: `phase-${i}` }),
      );
      await writeTickVerdictsLog(repo.dir, verdicts);

      const r = await runCli(repo.dir, ["log", "-n", "2"]);
      expect(r.code).toBe(0);
      const lines = r.out.trim().split("\n");
      expect(lines).toHaveLength(2);
      expect(lines[0]).toContain("phase-3");
      expect(lines[1]).toContain("phase-4");
    } finally {
      await repo.cleanup();
    }
  }, SPAWN_BUDGET_MS);

  // Absence alone is not a verdict here: `flume log -n 0` over a log the CLI
  // never opened prints the same nothing as one it read and suppressed. The
  // default form runs first over the same fixture, so the history is proved
  // printable before `-n 0` is asked to print none of it.
  it("flume log -n 0 prints nothing over a history the default form does print", async () => {
    const repo = await makeJobRepo("main");
    try {
      const verdicts = Array.from({ length: 5 }, (_, i) =>
        makeVerdict({ phaseName: `phase-${i}` }),
      );
      await writeTickVerdictsLog(repo.dir, verdicts);

      const full = await runCli(repo.dir, ["log"]);
      expect(full.code).toBe(0);
      expect(full.out.trim().split("\n")).toHaveLength(verdicts.length);
      for (const v of verdicts) expect(full.out).toContain(v.phaseName);

      const r = await runCli(repo.dir, ["log", "-n", "0"]);
      expect(r.code).toBe(0);
      expect(r.out.trim()).toBe("");
    } finally {
      await repo.cleanup();
    }
  }, SPAWN_BUDGET_MS);

  it("--json emits the TickVerdict records verbatim as JSONL, one per line", async () => {
    const repo = await makeJobRepo("main");
    try {
      const verdicts = [
        makeVerdict({
          phaseName: "build",
          committed: true,
          gateResults: [{ gate: "tsc", ok: true, message: "clean" }],
          shippedTags: ["TAG-A"],
          mergeOutcomes: [{ entryTag: "TAG-A", outcome: "merged" }],
        }),
        makeVerdict({
          phaseName: "plan",
          committed: false,
          noCommit: "clean-exit",
        }),
      ];
      await writeTickVerdictsLog(repo.dir, verdicts);

      const r = await runCli(repo.dir, ["log", "--json"]);
      expect(r.code).toBe(0);
      const lines = r.out.trim().split("\n");
      expect(lines).toHaveLength(2);
      expect(JSON.parse(lines[0]!)).toEqual(verdicts[0]);
      expect(JSON.parse(lines[1]!)).toEqual(verdicts[1]);
    } finally {
      await repo.cleanup();
    }
  }, SPAWN_BUDGET_MS);

  it("no tick-verdicts.jsonl prints nothing and exits 0", async () => {
    const repo = await makeJobRepo("main");
    try {
      const r = await runCli(repo.dir, ["log"]);
      expect(r.code).toBe(0);
      expect(r.out.trim()).toBe("");
    } finally {
      await repo.cleanup();
    }
  }, SPAWN_BUDGET_MS);

  // The converse of the case above, and the reason it cannot be the verb's
  // only silent arm: exit 0 over silence is reserved for a log that is not
  // there. spec/cli.md gives `log` no other quiet reading, so a log that is
  // present and unreadable exits EX_IOERR naming it.
  it("a tick-verdicts.jsonl that is present and unreadable exits EX_IOERR instead of printing nothing", async () => {
    const repo = await makeJobRepo("main");
    try {
      const verdicts = [makeVerdict({ phaseName: "plan" })];
      await writeTickVerdictsLog(repo.dir, verdicts);

      // Non-vacuity: the row really does print before the log is denied.
      const full = await runCli(repo.dir, ["log"]);
      expect(full.code).toBe(0);
      expect(full.out).toContain("plan");

      // Structural denial at the read path itself (`tests/helpers/denial.ts`)
      // — a stat still finds the entry, the read fails non-ENOENT.
      denyFile(tickVerdictsLogPath(join(repo.dir, ".flume")));

      const r = await runCli(repo.dir, ["log"]);
      expect(r.code).toBe(EX_IOERR);
      expect(r.out).toContain("failed to read");
      expect(r.out).toContain("tick-verdicts.jsonl");
    } finally {
      await repo.cleanup();
    }
  }, SPAWN_BUDGET_MS);

  // Same shape: a `flume log` that read nothing also touches no flag. The
  // rendered verdict is asserted first, so the untouched baton is the
  // read-only claim rather than a no-op's shadow. The flag's own path comes
  // from the engine's `awakeDir` — a hand-spelled one is absent either way.
  it("flume log renders the verdict it read without creating an awake flag", async () => {
    const repo = await makeJobRepo("main");
    try {
      await writeTickVerdictsLog(repo.dir, [
        makeVerdict({ phaseName: "build" }),
      ]);

      const r = await runCli(repo.dir, ["log"]);
      expect(r.code).toBe(0);
      const line = r.out.trim();
      expect(line).toContain("build");
      expect(line).toContain("committed=false");
      expect(existsSync(awakeDir(join(repo.dir, ".flume")))).toBe(false);
    } finally {
      await repo.cleanup();
    }
  }, SPAWN_BUDGET_MS);

  // LOG-TAGLESS-SPAN-ROW — `TickVerdictMergeOutcome.tag` is absent on a
  // singleton phase's own span, and the human line used to interpolate it
  // unconditionally, printing `undefined:merged`. Both legs run through the
  // real CLI so the rendering is read off the real formatter, not a copy.
  it("flume log renders a merge outcome carrying no tag as the outcome alone", async () => {
    const repo = await makeJobRepo("main");
    try {
      await writeTickVerdictsLog(repo.dir, [
        makeVerdict({
          phaseName: "plan",
          committed: true,
          shippedTags: [],
          mergeOutcomes: [{ outcome: "merged" }],
        }),
      ]);

      const r = await runCli(repo.dir, ["log"]);
      expect(r.code).toBe(0);
      const line = r.out.trim();
      expect(line).toContain("merge=[merged]");
      expect(line).not.toContain("undefined");
      // The phase name is the line's own first field, never restated as a
      // stand-in tag for the span.
      expect(line).not.toContain("plan:merged");
    } finally {
      await repo.cleanup();
    }
  }, SPAWN_BUDGET_MS);

  it("flume log renders a tagged merge outcome as tag:outcome", async () => {
    const repo = await makeJobRepo("main");
    try {
      await writeTickVerdictsLog(repo.dir, [
        makeVerdict({
          phaseName: "build",
          committed: true,
          shippedTags: ["TAG-A"],
          mergeOutcomes: [
            { entryTag: "TAG-A", outcome: "merged" },
            { entryTag: "TAG-B", outcome: "not-shipped" },
          ],
        }),
      ]);

      const r = await runCli(repo.dir, ["log"]);
      expect(r.code).toBe(0);
      const line = r.out.trim();
      expect(line).toContain("merge=[TAG-A:merged,TAG-B:not-shipped]");
      expect(line).not.toContain("undefined");
    } finally {
      await repo.cleanup();
    }
  }, SPAWN_BUDGET_MS);

  it("--help short-circuits before any side effect", async () => {
    const repo = await makeJobRepo("main");
    try {
      const r = await runCli(repo.dir, ["log", "--help"]);
      expect(r.code).toBe(0);
      expect(r.out).toContain("Usage: flume log");
      expect(existsSync(join(repo.dir, ".flume"))).toBe(false);
    } finally {
      await repo.cleanup();
    }
  }, SPAWN_BUDGET_MS);
});
