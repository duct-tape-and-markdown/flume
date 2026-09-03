/**
 * Help-text and subcommand-table seam — split from tests/cli.test.ts along
 * the same seam as `src/cliHelp.ts` (`.claude/rules/posture-sweep.md`, "A
 * violation counts only when verified on disk this tick").
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { runCli } from "./helpers/subprocess.ts";

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
