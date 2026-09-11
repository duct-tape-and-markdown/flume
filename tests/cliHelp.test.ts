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

import { mkFixtureRoot, runCli } from "./helpers/subprocess.ts";

/**
 * CLI-HELP-TICK-MISSING-EXIT2 — `flume tick --help`'s documented exit-code
 * list must cover `tickExitCode`'s actual range (0/1/2/69/78), so the 2 the
 * CJS-context refusal returns (tested above) isn't a silent gap in the
 * runtime help text.
 */
describe("flume tick --help — exit-code list matches tickExitCode's range (CLI-HELP-TICK-MISSING-EXIT2)", () => {
  it("lists 0, 1, 2, 69, and 78", async () => {
    const { out, code } = await runCli(process.cwd(), ["tick", "--help"]);
    expect(code).toBe(0);
    for (const exitCode of ["0 ", "1 ", "2 ", "69 ", "78 "]) {
      expect(out).toContain(`\n  ${exitCode}`);
    }
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
