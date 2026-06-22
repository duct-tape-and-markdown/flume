/**
 * §12 / §14 — CLI env canonicalization.
 *
 * After resolution, `process.env.FLUME_DIR` / `process.env.FLUME_CONFIG_DIR`
 * must hold the **absolute resolved** state root, so a chain loaded later in
 * the same process (and any spawned child) reads one canonical value rather
 * than re-deriving the default or a coincidentally-equal `configDir`. Exercised
 * at the resolution seam (`resolveStateDirs`) for the env-unset (default) and
 * env-set-relative cases.
 */

import { isAbsolute, join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { resolveStateDirs } from "../src/cli.ts";

const repoRoot = "/repo/root";

describe("resolveStateDirs", () => {
  it("defaults both roots to <repoRoot>/.flume and writes them back absolute when env is unset", () => {
    const env: NodeJS.ProcessEnv = {};
    const { flumeDir, configDir } = resolveStateDirs(env, repoRoot);

    const expected = join(repoRoot, ".flume");
    expect(flumeDir).toBe(expected);
    expect(configDir).toBe(expected);
    expect(isAbsolute(flumeDir)).toBe(true);
    expect(isAbsolute(configDir)).toBe(true);

    // Canonicalized back into the env for later chain loads / spawned children.
    expect(env.FLUME_DIR).toBe(expected);
    expect(env.FLUME_CONFIG_DIR).toBe(expected);
  });

  it("resolves a set-but-relative FLUME_DIR / FLUME_CONFIG_DIR to absolute and writes it back", () => {
    const env: NodeJS.ProcessEnv = {
      FLUME_DIR: "tmp/dock",
      FLUME_CONFIG_DIR: "tmp/cfg",
    };
    const { flumeDir, configDir } = resolveStateDirs(env, repoRoot);

    // resolve() is cwd-relative — the canonical form is absolute regardless.
    expect(flumeDir).toBe(resolve("tmp/dock"));
    expect(configDir).toBe(resolve("tmp/cfg"));
    expect(isAbsolute(flumeDir)).toBe(true);
    expect(isAbsolute(configDir)).toBe(true);

    expect(env.FLUME_DIR).toBe(flumeDir);
    expect(env.FLUME_CONFIG_DIR).toBe(configDir);
  });

  it("leaves an already-absolute FLUME_DIR untouched and independent of configDir", () => {
    const env: NodeJS.ProcessEnv = {
      FLUME_DIR: "/var/dock/state",
      FLUME_CONFIG_DIR: "/etc/flume/config",
    };
    const { flumeDir, configDir } = resolveStateDirs(env, repoRoot);

    expect(flumeDir).toBe("/var/dock/state");
    expect(configDir).toBe("/etc/flume/config");
    expect(env.FLUME_DIR).toBe("/var/dock/state");
    expect(env.FLUME_CONFIG_DIR).toBe("/etc/flume/config");
  });
});
