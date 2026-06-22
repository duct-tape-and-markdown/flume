import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { renderPrompt } from "../src/Prompt.ts";
import type { Phase } from "../src/Phase.ts";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "flume-prompt-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function phase(): Phase {
  return {
    name: "plan",
    description: "test phase",
    promptPath: "prompt.md",
    concurrency: "singleton",
    writablePaths: ["**"],
    gates: [],
    handoff: () => [],
  };
}

describe("renderPrompt — reserved {{FLUME_DIR}} arg (§16)", () => {
  it("auto-injects FLUME_DIR so a prompt resolves it with no chain-declared arg", async () => {
    const promptFile = join(dir, "prompt.md");
    await writeFile(promptFile, "read {{FLUME_DIR}}/plan/pending.json\n", "utf8");

    const out = await renderPrompt({
      phase: phase(),
      flumeDir: "/abs/state-root",
      promptFile,
      cwd: dir,
      args: {}, // chain supplies nothing
    });

    expect(out).toContain("read /abs/state-root/plan/pending.json");
    expect(out).not.toContain("{{FLUME_DIR}}");
  });

  it("FLUME_DIR is reserved — a chain-supplied arg cannot shadow the resolved root", async () => {
    const promptFile = join(dir, "prompt.md");
    await writeFile(promptFile, "root={{FLUME_DIR}}\n", "utf8");

    const out = await renderPrompt({
      phase: phase(),
      flumeDir: "/resolved",
      promptFile,
      cwd: dir,
      args: { FLUME_DIR: "/chain-supplied-WRONG" },
    });

    expect(out).toContain("root=/resolved");
    expect(out).not.toContain("chain-supplied-WRONG");
  });
});
