/**
 * The temp-repo fixture and the verdict/chain fixtures `Dispatcher.test.ts`
 * and `loopSupervisor.test.ts` both drive. Shared rather than copied when the
 * supervisor suites moved out of `Dispatcher.test.ts` alongside
 * `src/loopSupervisor.ts` — two copies of one fixture is a second thing that
 * can go stale (`.claude/rules/engineering.md`, "Derived state is computed,
 * never restated beside its source").
 *
 * Not *.test.ts, so neither vitest lane collects it as a suite of its own.
 */

import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import type { Logger, TickVerdict } from "../../src/Dispatcher.ts";
import { RUNTIME_IGNORES } from "../../src/job.ts";

const exec = promisify(execFile);

/** A logger that swallows every level — the default for suites asserting on facts, not output. */
export const silent: Logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
};

/**
 * A minimally-valid {@link TickVerdict} — every field `readTickVerdicts`'s
 * structural check requires, defaulted to a clean committed tick. Tests that
 * stub a real `flume tick` child process (writing `tick-verdict.json`
 * directly, as `superviseLoop`'s own suites do) build off this so a stub
 * missing a required field doesn't silently read back as "no verdict".
 */
export function verdictFixture(over: Partial<TickVerdict> = {}): TickVerdict {
  return {
    phaseName: "build",
    tags: [],
    committed: true,
    gateResults: [],
    shippedTags: [],
    mergeOutcomes: [],
    invocations: [],
    summary: "build shipped nothing → hibernate",
    headSha: "0".repeat(40),
    at: "2024-01-01T00:00:00.000Z",
    ...over,
  };
}

// ---------- temp-repo fixture ----------

export interface Fixture {
  repo: string;
  configDir: string;
  cleanup: () => Promise<void>;
}

export async function makeFixture(): Promise<Fixture> {
  const repo = await mkdtemp(join(tmpdir(), "flume-dispatcher-repo-"));
  const opts = { cwd: repo };
  await exec("git", ["init", "-q"], opts);
  await exec("git", ["config", "user.email", "test@example.com"], opts);
  await exec("git", ["config", "user.name", "Test User"], opts);
  await exec("git", ["config", "commit.gpgsign", "false"], opts);
  // Byte-exact checkout on Windows: revert-path assertions compare file
  // content, and a host-level autocrlf=true would rewrite LF on reset.
  await exec("git", ["config", "core.autocrlf", "false"], opts);
  // Deep-path fixtures (prior-attempts/<key>.reverted/<rel> etc.) push git
  // operations on this repo past win32's ~260-char default limit; without
  // this pin git itself — not just Node's fs calls — refuses the path.
  await exec("git", ["config", "core.longpaths", "true"], opts);
  await writeFile(join(repo, "README.md"), "seed\n");
  // What an adopting repo carries (README, "Relocating state"): the
  // runtime's gitignored record dirs under the default `.flume/`, so a
  // tick's own durable artifacts never read as untracked bystander work.
  await writeFile(
    join(repo, ".gitignore"),
    RUNTIME_IGNORES.map((e) => `.flume/${e}`).join("\n") + "\n",
  );
  await mkdir(join(repo, "src"), { recursive: true });
  await writeFile(join(repo, "src", "seed.ts"), "// seed\n");
  await exec("git", ["add", "."], opts);
  await exec("git", ["commit", "-q", "-m", "seed"], opts);

  const configDir = await mkdtemp(join(tmpdir(), "flume-dispatcher-cfg-"));
  await writeFile(join(configDir, "prompt.md"), "dummy prompt\n", "utf8");

  return {
    repo,
    configDir,
    cleanup: async () => {
      await rm(repo, { recursive: true, force: true });
      await rm(configDir, { recursive: true, force: true });
    },
  };
}

/** The state-root-relative chain fields {@link writeMinimalChain} can declare. */
export interface MinimalChainDeclarations {
  /** `Chain.friction`, verbatim — omitted from the chain when absent. */
  friction?: string;
  /** `Chain.pendingPath`, verbatim — omitted from the chain when absent. */
  pendingPath?: string;
}

/**
 * Minimal, otherwise-valid chain.ts: one singleton "build" phase, no gates,
 * empty handoff. Each declaration in `declared` is spliced in as that
 * field's value (JSON-encoded here, so callers pass the path itself); a
 * field absent from `declared` is absent from the chain.
 */
export async function writeMinimalChain(
  cfg: string,
  declared: MinimalChainDeclarations = {},
): Promise<void> {
  await mkdir(cfg, { recursive: true });
  await writeFile(join(cfg, "prompt.md"), "dummy\n", "utf8");
  const fields = (["friction", "pendingPath"] as const)
    .filter((f) => declared[f] !== undefined)
    .map((f) => `, ${f}: ${JSON.stringify(declared[f])}`)
    .join("");
  await writeFile(
    join(cfg, "chain.ts"),
    `export default () => ({ chain: { phases: [{ name: "build", ` +
      `description: "", promptPath: "prompt.md", concurrency: "singleton", ` +
      `writablePaths: ["**"], gates: [], handoff: () => [] }], ` +
      `humanOnly: []${fields} } });\n`,
    "utf8",
  );
}
