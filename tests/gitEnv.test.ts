/**
 * The git-environment helper's own suite: the auto-gc pin every fixture
 * repository's git inherits (`pinGitAutoGcOff`, `tests/helpers/gitEnv.ts`),
 * read both as a function over an environment and as the wiring
 * `tests/helpers/vitestSetup.ts` arms for each worker.
 *
 * A background `git gc` inside a fixture repo rewrites refs under a suite
 * mid-assertion, so the pin is a refusal to run over an unpinned host
 * (`.claude/rules/engineering.md`, "Loud or nothing") — and a pin that only
 * returns the right object, without the arming that reaches a real `git`,
 * would be green over nothing.
 */

import { realpath, rm } from "node:fs/promises";

import { describe, expect, it, vi } from "vitest";

import { mkFixtureRoot } from "./helpers/fixtureRoot.ts";
import { pinGitAutoGcOff } from "./helpers/gitEnv.ts";
import { SPAWN_BUDGET_MS, exec } from "./helpers/subprocess.ts";

// This file starts processes, so it declares the lane's one budget — cases
// and hooks alike — once here rather than inheriting the runner's default
// (`SPAWN_BUDGET_MS`, `tests/helpers/subprocess.ts`).
vi.setConfig({ testTimeout: SPAWN_BUDGET_MS, hookTimeout: SPAWN_BUDGET_MS });

/**
 * The end of the pin that matters: not what `pinGitAutoGcOff` returns, but
 * what a real `git` resolves inside a fixture the suite created, with the
 * environment `tests/helpers/vitestSetup.ts` armed for this worker
 * (`.claude/rules/engineering.md`, "A seam gate reads what the real writer
 * wrote").
 *
 * Top-level rather than under the describe below, because its subject is the
 * wiring rather than the function.
 */
it("a temp git repository the suite creates has git's auto gc disabled", async () => {
  const repo = await mkFixtureRoot("flume-auto-gc-");
  try {
    const opts = { cwd: repo };
    await exec("git", ["init", "-q", "-b", "main"], opts);

    // Non-vacuity: git answered from inside the fixture this test created,
    // not from an ancestor repository whose own config would otherwise be
    // what the assertion below reads.
    const { stdout: top } = await exec(
      "git",
      ["rev-parse", "--show-toplevel"],
      opts,
    );
    expect(await realpath(top.trim())).toBe(await realpath(repo));

    const { stdout } = await exec(
      "git",
      ["config", "--type=int", "--get", "gc.auto"],
      opts,
    );
    expect(stdout.trim()).toBe("0");
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

describe("pinGitAutoGcOff — appended to the host's git config sequence, never over it", () => {
  it("appends beside a sequence the host already declared", () => {
    const env: NodeJS.ProcessEnv = {
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: "protocol.version",
      GIT_CONFIG_VALUE_0: "2",
    };

    expect(pinGitAutoGcOff(env)).toBe(env);
    expect(env).toEqual({
      GIT_CONFIG_COUNT: "2",
      GIT_CONFIG_KEY_0: "protocol.version",
      GIT_CONFIG_VALUE_0: "2",
      GIT_CONFIG_KEY_1: "gc.auto",
      GIT_CONFIG_VALUE_1: "0",
    });
  });

  it("re-arming one environment overwrites in place rather than growing the sequence", () => {
    const env: NodeJS.ProcessEnv = {
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: "gc.auto",
      GIT_CONFIG_VALUE_0: "6700",
    };

    pinGitAutoGcOff(env);
    pinGitAutoGcOff(env);

    expect(env).toEqual({
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: "gc.auto",
      GIT_CONFIG_VALUE_0: "0",
    });
  });

  it("refuses a GIT_CONFIG_COUNT that is not a count, rather than writing over the pair it names", () => {
    const env: NodeJS.ProcessEnv = {
      GIT_CONFIG_COUNT: "two",
      GIT_CONFIG_KEY_0: "protocol.version",
    };

    expect(() => pinGitAutoGcOff(env)).toThrow(/GIT_CONFIG_COUNT/);
    expect(env.GIT_CONFIG_KEY_0).toBe("protocol.version");
  });
});
