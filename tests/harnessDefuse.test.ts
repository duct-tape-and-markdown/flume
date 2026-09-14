/**
 * The package substitutes content it did not author into its prompts; the
 * engine's renderer treats substituted text as prompt syntax. These cases
 * drive the real renderer: a value quoting the span grammar renders inert
 * once defused, and the engine's grammar still matches the raw value, which
 * is the property the defuse exists to break.
 */

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { renderPrompt } from "../src/index.ts";
import type { Phase } from "../src/Phase.ts";
import { defuseArgs, defuseSpans } from "../harness/defuse.ts";

const phaseFor = (promptFile: string): Phase => ({
  name: "defuse-fixture",
  description: "renders one substituted value",
  promptPath: promptFile,
  concurrency: "singleton",
  writablePaths: [],
  gates: [],
  handoff: () => [],
});

const GRAMMAR = "documented as !`cmd` — a span whose command is not a program";

describe("defused prompt args", () => {
  let dir: string | undefined;
  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it("the raw value carries a live span the engine would execute; the defused one does not", async () => {
    dir = await mkdtemp(join(tmpdir(), "flume-defuse-"));
    const promptFile = join(dir, "p.md");
    await writeFile(promptFile, "# Section\n\n{{TEXT}}\n");
    // Vacuity pin: the fixture really carries the grammar the engine scans for.
    expect(GRAMMAR).toMatch(/!\s*`[^`]+`/);
    await expect(
      renderPrompt({ phase: phaseFor(promptFile), promptFile, args: { TEXT: GRAMMAR }, cwd: dir, flumeDir: dir }),
    ).rejects.toThrow(/inline-exec/);
    const rendered = await renderPrompt({
      phase: phaseFor(promptFile),
      promptFile,
      args: defuseArgs({ TEXT: GRAMMAR }),
      cwd: dir,
      flumeDir: dir,
    });
    expect(rendered).toContain("cmd");
    expect(rendered.replace(/​/g, "")).toContain(GRAMMAR);
  });

  it("defusing is idempotent, touches nothing else, and strips back to the original", () => {
    const once = defuseSpans(GRAMMAR);
    expect(defuseSpans(once)).toBe(once);
    expect(defuseSpans("no span here `code` and ! alone")).toBe("no span here `code` and ! alone");
    expect(once.replace(/​/g, "")).toBe(GRAMMAR);
  });
});
