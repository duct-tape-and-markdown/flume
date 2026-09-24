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

import { mkdirSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import type { Logger } from "../../src/log.ts";
import { tickVerdictPath, type TickVerdict } from "../../src/tickVerdict.ts";
import { RUNTIME_IGNORES } from "../../src/runtimeIgnores.ts";

import { mkTempDir } from "./fixtureRoot.ts";
import {
  minimalChainSrc,
  type MinimalChainDeclarations,
} from "./repoChain.ts";
import { exec } from "./subprocess.ts";

/** A logger that swallows every level — the default for suites asserting on facts, not output. */
export const silent: Logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
};

/**
 * A minimally-valid {@link TickVerdict} — every field `readTickVerdicts`'s
 * structural check requires, defaulted to a clean committed tick. Tests that
 * stub a real `flume tick` child process (writing the verdict file
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

/**
 * Where a child `flume tick` of `phase` leaves its verdict, with the
 * directory the real writer creates (`writeTickVerdict`, `src/tickVerdict.ts`)
 * already in place.
 *
 * A stub standing in for that child writes there and the supervisor reads
 * there, so the two agree by taking one accessor rather than by both
 * spelling a path. The `mkdir` is what a stub would otherwise repeat at
 * every site — and a suite that goes on to deny the path structurally
 * (`tests/helpers/denial.ts`) needs the parent standing, since denial never
 * creates one.
 */
export function childVerdictPath(flumeDir: string, phase: string): string {
  const p = tickVerdictPath(flumeDir, phase);
  mkdirSync(dirname(p), { recursive: true });
  return p;
}

// ---------- temp-repo fixture ----------

export interface Fixture {
  repo: string;
  configDir: string;
  cleanup: () => Promise<void>;
}

/**
 * A seeded temp git repository and its config dir, both rooted at the
 * spelling git reports (`mkTempDir`, tests/helpers/fixtureRoot.ts) — every
 * worktree-registry and `rev-parse` verdict in the suites below compares a
 * path composed from `repo` against one git emitted.
 *
 * `parent` is the directory the two roots are created under; the tests that
 * drive the fixture through a link supply their own.
 */
export async function makeFixture(parent: string = tmpdir()): Promise<Fixture> {
  const repo = await mkTempDir("flume-dispatcher-repo-", parent);
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

  const configDir = await mkTempDir("flume-dispatcher-cfg-", parent);
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

/**
 * Minimal, otherwise-valid chain.ts: one singleton "build" phase, no gates,
 * empty handoff, written flat — the prompt file beside the chain rather than
 * under the `prompts/` dir `writeRepoConfig` materializes. The source itself
 * is the shared one (`minimalChainSrc`, `repoChain.ts`); what this fixture
 * owns is the layout and the phase these suites tick.
 */
export async function writeMinimalChain(
  cfg: string,
  declared: MinimalChainDeclarations = {},
): Promise<void> {
  await mkdir(cfg, { recursive: true });
  await writeFile(join(cfg, "prompt.md"), "dummy\n", "utf8");
  await writeFile(
    join(cfg, "chain.ts"),
    minimalChainSrc({ ...declared, name: "build", promptPath: "prompt.md" }),
    "utf8",
  );
}
