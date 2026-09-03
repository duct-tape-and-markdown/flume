/**
 * Tick/loop verdict exit-code + formatting seam — split from
 * tests/cli.test.ts along the same seam as `src/cliVerdict.ts`
 * (`.claude/rules/posture-sweep.md`, "A violation counts only when verified
 * on disk this tick"). Unit-level `tickExitCode`/`loopExitCode`/
 * `loopCompletionSummary` cases plus the real-CLI `flume log` suite, which
 * exercises `formatTickVerdictLine`'s rendering through the CLI read-side.
 */

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

import {
  EX_TERMINAL_MISCONFIG,
  EX_MOUNT_DEAD,
  type TickOutcome,
  type SuperviseResult,
  type TickVerdict,
} from "../src/Dispatcher.ts";
import {
  tickExitCode,
  loopExitCode,
  loopCompletionSummary,
} from "../src/cliVerdict.ts";
import { runCli } from "./helpers/subprocess.ts";

const exec = promisify(execFile);

describe("tickExitCode — §3 axis classification", () => {
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

  it("mount-dead: chain resolution failure (v0.7 §4) → 69 (EX_UNAVAILABLE)", () => {
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

  it("CJS-context usage error (v0.7 §5) → 2, checked ahead of the mount-dead fallback", () => {
    const outcome: TickOutcome = {
      hibernated: false,
      usageError: true,
      awakeAfter: ["plan"],
      summary: '.flume/chain.ts failed to load: ... add "type": "module" ...',
    };
    expect(tickExitCode(outcome)).toBe(2);

    // usageError and failed are documented as mutually exclusive, but the
    // mapping itself must still prefer 2 if both were ever set — the §5
    // usage refusal is never allowed to collapse back into EX_MOUNT_DEAD.
    const both: TickOutcome = { ...outcome, failed: true };
    expect(tickExitCode(both)).toBe(2);
  });
});

describe("loopExitCode / loopCompletionSummary — §4 amended exit-code contract", () => {
  it("a run with one errored tick and one shipped entry: exits 0, summary names the error", () => {
    const result: SuperviseResult = {
      ticks: 2,
      hibernated: true,
      shippedTags: ["SHIPPED-ENTRY"],
      erroredTicks: ["build: no commit (gate-revert) → hibernate"],
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
      erroredTicks: ["plan: no commit (voluntary-bail) → hibernate"],
    };
    expect(loopExitCode(result)).toBe(1);
    expect(loopCompletionSummary(result)).toContain("voluntary-bail");
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
    };
    expect(loopExitCode(result)).toBe(1);
    expect(loopCompletionSummary(result)).toContain(
      "3 tick(s) errored",
    );
  });

  it("settled with nothing to do (no errors, nothing shipped) → 0, no completion summary", () => {
    const result: SuperviseResult = {
      ticks: 1,
      hibernated: true,
      shippedTags: [],
      erroredTicks: [],
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
    };
    expect(loopExitCode(result)).toBe(EX_MOUNT_DEAD);
  });

  // v0.7 §16 — the consecutive-provisioning-failure abort backstop: non-zero
  // and named in the summary regardless of how much the run shipped before
  // hitting the wall (unlike the plain errored/nothing-shipped rule above).
  it("repeatedFailure aborts non-zero and names the signature, even with entries shipped", () => {
    const result: SuperviseResult = {
      ticks: 3,
      hibernated: false,
      repeatedFailure: { signature: "EBUSY: resource busy or locked", count: 3 },
      shippedTags: ["SHIPPED-BEFORE-THE-WALL"],
      erroredTicks: [],
    };
    expect(loopExitCode(result)).toBe(1);
    expect(loopCompletionSummary(result)).toContain(
      "EBUSY: resource busy or locked",
    );
  });

  // v0.8 §8 — the abort threshold is chain-overridable, so the completion
  // summary must name the real streak count, not the v0.7 §16 literal 3.
  it("names the real repeatedFailure.count, not a hardcoded 3", () => {
    const result: SuperviseResult = {
      ticks: 2,
      hibernated: false,
      repeatedFailure: { signature: "EBUSY: resource busy or locked", count: 2 },
      shippedTags: [],
      erroredTicks: [],
    };
    expect(loopCompletionSummary(result)).toContain("2 consecutive ticks");
    expect(loopCompletionSummary(result)).not.toContain("3 consecutive ticks");
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
    };
    expect(loopExitCode(result)).toBe(0);
    expect(loopCompletionSummary(result)).toContain("stop flag");
  });
});

// ---------- v0.6 §2/§3 — job resolution through the real CLI ----------

/**
 * Scratch git repo on a chosen branch. The engine has no opinion on branch
 * names (v0.11 §2) — some fixtures below pin `job/foo` merely as a
 * distinctive label, proven inert by running job resolution on `main`
 * instead.
 */
async function makeJobRepo(branch: string): Promise<{
  dir: string;
  cleanup: () => Promise<void>;
}> {
  const dir = await mkdtemp(join(tmpdir(), "flume-job-"));
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
 * (`src/Dispatcher.ts`), constructed by hand here since `flume log` reads
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
    summary: `${overrides.phaseName} placeholder`,
    headSha: "0".repeat(40),
    at: "2024-01-01T00:00:00.000Z",
    ...overrides,
  };
}

/** Write `tick-verdicts.jsonl` directly under `<root>/.flume` — the log `readTickVerdicts` (`src/Dispatcher.ts`) reads, oldest first, top to bottom. */
async function writeTickVerdictsLog(
  root: string,
  verdicts: TickVerdict[],
): Promise<void> {
  await mkdir(join(root, ".flume"), { recursive: true });
  await writeFile(
    join(root, ".flume", "tick-verdicts.jsonl"),
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
          mergeOutcomes: [{ tag: `tag-${i}`, outcome: "merged" }],
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
  }, 30_000);

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
  }, 30_000);

  it("-n 0 prints nothing and exits 0, not the full history", async () => {
    const repo = await makeJobRepo("main");
    try {
      const verdicts = Array.from({ length: 5 }, (_, i) =>
        makeVerdict({ phaseName: `phase-${i}` }),
      );
      await writeTickVerdictsLog(repo.dir, verdicts);

      const r = await runCli(repo.dir, ["log", "-n", "0"]);
      expect(r.code).toBe(0);
      expect(r.out.trim()).toBe("");
    } finally {
      await repo.cleanup();
    }
  }, 30_000);

  it("--json emits the TickVerdict records verbatim as JSONL, one per line", async () => {
    const repo = await makeJobRepo("main");
    try {
      const verdicts = [
        makeVerdict({
          phaseName: "build",
          committed: true,
          gateResults: [{ gate: "tsc", ok: true, message: "clean" }],
          shippedTags: ["TAG-A"],
          mergeOutcomes: [{ tag: "TAG-A", outcome: "merged" }],
        }),
        makeVerdict({
          phaseName: "plan",
          committed: false,
          noCommit: "voluntary-bail",
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
  }, 30_000);

  it("no tick-verdicts.jsonl prints nothing and exits 0", async () => {
    const repo = await makeJobRepo("main");
    try {
      const r = await runCli(repo.dir, ["log"]);
      expect(r.code).toBe(0);
      expect(r.out.trim()).toBe("");
    } finally {
      await repo.cleanup();
    }
  }, 30_000);

  it("mutates no baton flag", async () => {
    const repo = await makeJobRepo("main");
    try {
      await writeTickVerdictsLog(repo.dir, [makeVerdict({ phaseName: "build" })]);

      const r = await runCli(repo.dir, ["log"]);
      expect(r.code).toBe(0);
      expect(existsSync(join(repo.dir, ".flume", "awake"))).toBe(false);
    } finally {
      await repo.cleanup();
    }
  }, 30_000);

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
  }, 30_000);
});
