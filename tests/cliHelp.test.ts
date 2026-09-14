/**
 * Help-text and subcommand-table seam — split from tests/cli.test.ts along
 * the same seam as `src/cliHelp.ts` (`.claude/rules/posture-sweep.md`, "A
 * violation counts only when verified on disk this tick").
 */

import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { tickExitCode } from "../src/cliVerdict.ts";
import type { TickOutcome, TickVerdict } from "../src/Dispatcher.ts";
import type { TickResult } from "../src/Phase.ts";
import { mkFixtureRoot, runCli } from "./helpers/subprocess.ts";

/**
 * CLI-HELP-TICK-MISSING-EXIT2 — `flume tick --help`'s exit-code list is the
 * prose copy of two facts with different owners: the range `tickExitCode`
 * (`src/cliVerdict.ts`) returns from a `TickOutcome`, and the codes the
 * `flume tick` process returns without ever reaching one. Neither is
 * hand-copied here. The first is derived by driving the real function over
 * the outcome space below; the second is {@link PROCESS_LEVEL_EXIT_CODES},
 * named with the refusal sites that produce it and asserted to hold nothing
 * `tickExitCode` can return. A code added to or dropped from either side
 * turns this red instead of shipping one-sided (`.claude/rules/
 * engineering.md`, "A seam gate reads what the real writer wrote").
 */
describe("flume tick --help — the exit-code list against tickExitCode's derived range (CLI-HELP-TICK-MISSING-EXIT2)", () => {
  /**
   * Exit codes the `flume tick` process returns that `tickExitCode` cannot:
   * cli.ts's own refusals, taken before a dispatcher outcome exists (the
   * detached-HEAD refusal, the held-tip-claim refusal) or in place of one
   * (main's harness-error exit). Named rather than derived — each is a
   * `return`/`process.exit` literal on a control path with no outcome value
   * to drive.
   */
  const PROCESS_LEVEL_EXIT_CODES = new Map<number, string>([
    [1, "detached HEAD or held tip claim refusal, or a harness error"],
  ]);

  /** Candidate standing for "this field is not set on the outcome". */
  const ABSENT = Symbol("absent");

  const A_TICK_RESULT: TickResult = {
    phaseName: "plan",
    committed: true,
    gateResults: [],
    pendingAfter: [],
    pickableAfter: [],
    shippedTags: [],
    revertedTags: [],
    flumeDir: ".flume",
    configDir: ".flume",
  };

  const A_TICK_VERDICT: TickVerdict = {
    phaseName: "plan",
    tags: [],
    committed: true,
    gateResults: [],
    shippedTags: [],
    mergeOutcomes: [],
    invocations: [],
    summary: "plan committed 0000000",
    headSha: "0".repeat(40),
    at: "2026-01-01T00:00:00.000Z",
  };

  const A_STAGE_FAILURE = { signature: "boom", message: "boom" };

  /**
   * One candidate list per `TickOutcome` field, keyed with the optionality
   * stripped so a field added to the outcome is a compile error here — the
   * point at which someone supplies its candidates. Every field carries a
   * present value as well as `ABSENT`, because a branch `tickExitCode` grows
   * on a field it ignores today is exactly the change this gate exists to
   * catch; a field left absent everywhere would let that branch ship green.
   * The values themselves are representative, not exhaustive: what varies
   * per field is presence, and per boolean, which of the two it holds.
   */
  const TICK_OUTCOME_SPACE: {
    [K in keyof TickOutcome]-?: readonly (TickOutcome[K] | typeof ABSENT)[];
  } = {
    hibernated: [false, true],
    failed: [ABSENT, false, true],
    usageError: [ABSENT, false, true],
    tipMoved: [ABSENT, false, true],
    declined: [ABSENT, false, true],
    terminal: [ABSENT, { kind: "orphaned-awake", phases: ["ghost"] }],
    phaseName: [ABSENT, "plan"],
    result: [ABSENT, A_TICK_RESULT],
    noCommit: [ABSENT, "clean-exit"],
    provisionFailures: [ABSENT, [A_STAGE_FAILURE]],
    mergeFailures: [ABSENT, [A_STAGE_FAILURE]],
    gateFailures: [ABSENT, [A_STAGE_FAILURE]],
    verdict: [ABSENT, A_TICK_VERDICT],
    awakeAfter: [[], ["plan"]],
    summary: ["no phases awake; hibernating"],
  };

  /**
   * Every outcome the table spans, `ABSENT` fields left unset. A generator,
   * not an array: the product runs to tens of thousands of outcomes, and
   * only the code each one maps to is worth keeping.
   */
  function* tickOutcomeSpace(
    fields: readonly (readonly [string, readonly unknown[]])[],
    partial: Record<string, unknown> = {},
  ): Generator<TickOutcome> {
    const [head, ...rest] = fields;
    if (!head) {
      yield partial as unknown as TickOutcome;
      return;
    }
    const [field, candidates] = head;
    for (const value of candidates) {
      yield* tickOutcomeSpace(
        rest,
        value === ABSENT ? partial : { ...partial, [field]: value },
      );
    }
  }

  /** The codes the help text's own "Exit codes:" block lists. */
  function documentedExitCodes(help: string): Set<number> {
    const start = help.indexOf("Exit codes:\n");
    expect(start).toBeGreaterThan(-1);
    const codes = new Set<number>();
    for (const line of help.slice(start).split("\n").slice(1)) {
      if (line.trim() === "") continue;
      // A continuation line is indented past its code; anything unindented
      // ended the block.
      if (!line.startsWith("  ")) break;
      const listed = /^ {2}(\d+) {2,}\S/.exec(line);
      if (listed) codes.add(Number(listed[1]));
    }
    return codes;
  }

  const ascending = (codes: Iterable<number>): number[] =>
    [...new Set(codes)].sort((a, b) => a - b);

  it("flume tick --help documents every exit code tickExitCode returns, beside a named process-level set", async () => {
    const returned = new Set<number>();
    let spanned = 0;
    for (const outcome of tickOutcomeSpace(
      Object.entries(TICK_OUTCOME_SPACE) as [string, readonly unknown[]][],
    )) {
      spanned++;
      returned.add(tickExitCode(outcome));
    }
    // Non-vacuity: an outcome space that collapsed, or a range that did,
    // would agree with almost any help text.
    expect(spanned).toBeGreaterThan(1);
    expect(returned.size).toBeGreaterThan(1);

    // The named set holds only what the function cannot return — the defect
    // this suite carried was a process-level code read as part of the
    // function's range, which let a real range change ship green.
    for (const [exitCode, site] of PROCESS_LEVEL_EXIT_CODES) {
      expect(
        returned.has(exitCode),
        `${exitCode} (${site}) is in tickExitCode's own range`,
      ).toBe(false);
    }

    const { out, code } = await runCli(process.cwd(), ["tick", "--help"]);
    expect(code).toBe(0);
    expect(ascending(documentedExitCodes(out))).toEqual(
      ascending([...returned, ...PROCESS_LEVEL_EXIT_CODES.keys()]),
    );
  });
});

/**
 * CLI-RENDER-REMOVAL — `render` previewed with the wrong fence, the wrong
 * prior-attempt state, and its own re-derivation of pickability that
 * disagreed with the dispatcher's (operator ruling 2026-08-03). It is gone
 * from the subcommand surface entirely, not merely undocumented.
 */
describe("flume render — removed from the subcommand surface (CLI-RENDER-REMOVAL)", () => {
  it("is an unknown subcommand and exits 2", async () => {
    const dir = await mkdtemp(join(tmpdir(), "flume-render-removed-"));
    try {
      const { out, code } = await runCli(dir, ["render", "probe"]);
      expect(code).toBe(2);
      expect(out).toContain("unknown command: render");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("no help text (flume --help, flume -h) names render", async () => {
    const dir = await mkdtemp(join(tmpdir(), "flume-render-removed-help-"));
    try {
      const long = await runCli(dir, ["--help"]);
      expect(long.code).toBe(0);
      expect(long.out).not.toContain("render");

      const short = await runCli(dir, ["-h"]);
      expect(short.code).toBe(0);
      expect(short.out).not.toContain("render");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

/**
 * CHECK-NO-FANOUT-SKIP-IN-PROSE — `check`'s third route to 0. A chain with
 * no fanout phase has no consumer, so the fence step is skipped and the
 * verb says so (spec/cli.md, "Subcommand surface"); both prose surfaces
 * described the fence as unconditional and left that route undocumented.
 *
 * The phrase under test is never hand-copied here: each pin drives the real
 * writer — `flume check` over a fanout-less chain — and asserts the surface
 * carries the clause that run actually printed
 * (`.claude/rules/engineering.md`, "A seam gate reads what the real writer
 * wrote").
 */
describe("flume check's no-consumer skip is documented (CHECK-NO-FANOUT-SKIP-IN-PROSE)", () => {
  /**
   * Run `flume check` over a chain declaring one singleton phase and
   * nothing that picks from pending; return the clause its skip line
   * carried past the parse report. The queue's entry declares files —
   * declared paths are what makes a skipped fence distinguishable from an
   * empty one refusing them all.
   */
  async function skipClauseFromRealRun(): Promise<string> {
    const dir = await mkFixtureRoot("flume-check-no-fanout-");
    try {
      await mkdir(join(dir, ".flume", "prompts"), { recursive: true });
      await mkdir(join(dir, ".flume", "plan"), { recursive: true });
      await writeFile(
        join(dir, ".flume", "chain.ts"),
        `export default () => ({ chain: {\n` +
          `  phases: [{\n` +
          `    name: "plan",\n` +
          `    description: "",\n` +
          `    promptPath: "prompts/prompt.md",\n` +
          `    concurrency: "singleton",\n` +
          `    writablePaths: [".flume/plan/**"],\n` +
          `    gates: [],\n` +
          `    handoff: () => [],\n` +
          `  }],\n` +
          `  humanOnly: [],\n` +
          `} });\n`,
        "utf8",
      );
      await writeFile(
        join(dir, ".flume", "prompts", "prompt.md"),
        "probe prompt\n",
        "utf8",
      );
      await writeFile(
        join(dir, ".flume", "plan", "pending.json"),
        JSON.stringify([
          {
            tag: "DECLARES-FILES",
            gate: { kind: "open" },
            dependsOnForks: [],
            files: {
              new: [],
              edit: [
                { path: "docs/readme.md", description: "declared, unfenced" },
              ],
              retire: [],
            },
          },
        ]) + "\n",
        "utf8",
      );

      const { out, code } = await runCli(dir, ["check"]);
      expect(code).toBe(0);
      const line = out.trim().split("\n").filter(Boolean).at(-1) ?? "";
      // Cut the parse report — "<rel> valid (N entries), " carries this
      // run's own counts, which no prose surface can restate.
      const cut = line.indexOf("), ");
      expect(cut).toBeGreaterThan(-1);
      const clause = line.slice(cut + "), ".length);
      expect(clause.length).toBeGreaterThan(0);
      expect(clause).not.toBe(line);
      return clause;
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  it("flume check --help names the no-fanout skip among the ways check exits 0", async () => {
    const clause = await skipClauseFromRealRun();
    const { out, code } = await runCli(process.cwd(), ["check", "--help"]);
    expect(code).toBe(0);
    const zero = out.slice(out.indexOf("\n  0 "), out.indexOf("\n  2 "));
    expect(zero.length).toBeGreaterThan(0);
    // Wrapped across help-text lines, so collapse whitespace before matching.
    expect(zero.replace(/\s+/g, " ")).toContain(clause);
  });

  it("docs/CLI.md's flume check section names the no-fanout skip", async () => {
    const clause = await skipClauseFromRealRun();
    const doc = await readFile(
      fileURLToPath(new URL("../docs/CLI.md", import.meta.url)),
      "utf8",
    );
    const start = doc.indexOf("## `flume check`");
    expect(start).toBeGreaterThan(-1);
    const next = doc.indexOf("\n## ", start + 1);
    const section = next === -1 ? doc.slice(start) : doc.slice(start, next);
    expect(section.replace(/\s+/g, " ")).toContain(clause);
  });
});
