/**
 * SUBPROCESS-TSX-SENTINEL — the shared CLI-subprocess harness's own suite.
 * Every other CLI suite *consumes* `tests/helpers/subprocess.ts`; this one
 * tests it, because the helper is where a CLI that never started used to
 * become an ordinary exit code 1 (`.claude/rules/engineering.md`, "A green
 * verdict is proven non-vacuous").
 */

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CLI,
  TSX_CLI,
  exitStatusOf,
  mkFixtureRoot,
  refuseLeakedStateRoots,
  refusePreexistingStateRoots,
  requireEntryPoint,
  runCli,
  watchStateRoots,
} from "./helpers/subprocess.ts";

const exec = promisify(execFile);

describe("requireEntryPoint — an unresolvable CLI entry point refuses (SUBPROCESS-TSX-SENTINEL)", () => {
  it("refuses by name instead of returning an exit code", async () => {
    const dir = await mkdtemp(join(tmpdir(), "flume-entry-point-"));
    try {
      const missing = join(dir, "node_modules", "tsx", "dist", "cli.mjs");
      expect(existsSync(missing)).toBe(false);

      // The status the refusal replaces: node exits 1 on a module it cannot
      // load, so the laundered value collided exactly with the 1 that the CLI
      // suites' `code).toBe(1)` assertions are written to check.
      const spawned = await exec(process.execPath, [missing]).then(
        () => ({ code: 0 }),
        (err: { code?: unknown }) => ({ code: err.code }),
      );
      expect(spawned.code).toBe(1);

      expect(() =>
        requireEntryPoint(missing, "run `pnpm install --frozen-lockfile`"),
      ).toThrow(missing);
      expect(() =>
        requireEntryPoint(missing, "run `pnpm install --frozen-lockfile`"),
      ).toThrow(/pnpm install --frozen-lockfile/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("passes the real entry points through, so the refusal is not armed on a provisioned tree", () => {
    for (const path of [CLI, TSX_CLI]) {
      expect(isAbsolute(path)).toBe(true);
      expect(existsSync(path)).toBe(true);
      expect(requireEntryPoint(path, "unreachable on a provisioned tree")).toBe(
        path,
      );
    }
  });
});

describe("the helper's tsx entry point is guarded, not merely guardable", () => {
  afterEach(() => {
    vi.doUnmock("node:fs");
    vi.resetModules();
  });

  it("refuses at import when node_modules/tsx/dist/cli.mjs is absent", async () => {
    vi.resetModules();
    vi.doMock("node:fs", async () => {
      const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
      return {
        ...actual,
        default: actual,
        existsSync: (p: Parameters<typeof actual.existsSync>[0]) =>
          p === TSX_CLI ? false : actual.existsSync(p),
      };
    });

    await expect(import("./helpers/subprocess.ts")).rejects.toThrow(
      /CLI entry point missing: .*tsx.*\n.*pnpm install --frozen-lockfile/s,
    );
  });
});

describe("exitStatusOf — a failure with no exit status refuses instead of reporting 1", () => {
  it("passes a real non-zero exit through", () => {
    expect(exitStatusOf({ code: 2, signal: null })).toBe(2);
    expect(exitStatusOf({ code: 1, signal: null })).toBe(1);
    expect(exitStatusOf({ code: 78, signal: null })).toBe(78);
  });

  it("refuses on a spawn failure, whose code is an errno string", () => {
    const err = Object.assign(new Error("spawn ENOENT"), {
      code: "ENOENT",
      signal: null,
    });
    expect(() => exitStatusOf(err)).toThrow(/no exit status/);
    expect(() => exitStatusOf(err)).toThrow(/ENOENT/);
  });

  it("refuses on a kill, which carries a signal and no code", () => {
    const err = Object.assign(new Error("killed"), {
      code: undefined,
      signal: "SIGKILL",
    });
    expect(() => exitStatusOf(err)).toThrow(/no exit status/);
    expect(() => exitStatusOf(err)).toThrow(/SIGKILL/);
  });
});

describe("runCli — reports the CLI's own status, not a default", () => {
  it("surfaces an exit code the CLI chose, distinct from the laundered 1", async () => {
    const dir = await mkdtemp(join(tmpdir(), "flume-runcli-status-"));
    try {
      const { out, code } = await runCli(dir, ["definitely-not-a-verb"]);
      expect(out).toContain("unknown command: definitely-not-a-verb");
      expect(code).toBe(2);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

/**
 * TMP-STATE-ROOT-WRITER-NAMED — the suite's own refusal to run over, or leak,
 * a flume state root above its fixtures. A leaked `/tmp/.flume` used to be
 * invisible on the run that wrote it and to red unrelated CLI tests on every
 * run after, with nothing naming either the directory or the writer
 * (`.claude/rules/engineering.md`, "Loud or nothing").
 *
 * Driven by the real writer: the CLI itself, run from a directory with no
 * `.flume` at or above it, which is exactly how the litter was produced —
 * `resolveRepoRoot` falls back to cwd, `stop` mkdirs the bay and writes the
 * flag, and the `Baton` constructor mkdirs `awake/`.
 */
describe("the suite refuses a flume state root above its fixtures", () => {
  it("a run that creates a state root above its own fixture fails the suite and names the offender", async () => {
    const attic = await mkdtemp(join(tmpdir(), "flume-leak-attic-"));
    try {
      const fixture = await mkFixtureRoot("flume-leak-fixture-", attic);
      const watch = watchStateRoots(dirname(fixture));

      // Non-vacuity: the watch covers the fixture's own parent, that bay is
      // not armed before the leak, and the watch is silent as it stands — so
      // the refusal below is the leak's doing, not a set already dirty.
      // Asserted on the parent's bay rather than on an empty `known`, because
      // the scope runs to the filesystem root: a host that already carries
      // litter is refused by this suite's own guard, not by this case.
      expect(watch.scope).toContain(join(attic, ".flume"));
      expect(watch.known.has(join(attic, ".flume"))).toBe(false);
      expect(() => refuseLeakedStateRoots(watch, "control")).not.toThrow();

      // The leak, written by the real CLI: `stop` plants the bay and the flag,
      // `status` builds a Baton and plants `awake/`.
      expect((await runCli(attic, ["stop"])).code).toBe(0);
      expect((await runCli(attic, ["status"])).code).toBe(0);
      expect(existsSync(join(attic, ".flume", "stop"))).toBe(true);
      expect(existsSync(join(attic, ".flume", "awake"))).toBe(true);

      const offender = "cli.test.ts > some suite > some leaking test";
      let reported = "";
      try {
        refuseLeakedStateRoots(watch, offender);
      } catch (err) {
        reported = String(err);
      }
      // Names the directory, the test it is attributed to, and the bound on
      // that attribution — vitest runs files in parallel, so the flag that
      // removes the ambiguity is part of the report.
      expect(reported).toContain(join(attic, ".flume"));
      expect(reported).toContain(offender);
      expect(reported).toContain("--no-file-parallelism");

      // A second look does not re-report what it already named: one leak
      // names one offender rather than reddening every test after it.
      expect(() => refuseLeakedStateRoots(watch, "a later test")).not.toThrow();

      // The fixture below the litter is unharmed — its own bay stops the walk,
      // so the guard is reporting a hazard to unrooted fixtures, not a break.
      const rooted = await runCli(fixture, ["status"]);
      expect(rooted.code).toBe(0);
      expect(rooted.out).not.toContain("stop present");
    } finally {
      await rm(attic, { recursive: true, force: true });
    }
  }, 60_000);

  it("refuses before its first test when the litter is already on disk", async () => {
    const attic = await mkdtemp(join(tmpdir(), "flume-leak-preexisting-"));
    try {
      // Control: the parent's own bay is not armed yet, so the refusal below
      // is the litter's doing.
      const clean = watchStateRoots(attic);
      expect(clean.scope).toContain(join(attic, ".flume"));
      expect(clean.known.has(join(attic, ".flume"))).toBe(false);

      await mkdir(join(attic, ".flume", "awake"), { recursive: true });
      const watch = watchStateRoots(attic);
      expect(watch.known.has(join(attic, ".flume"))).toBe(true);
      expect(() => refusePreexistingStateRoots(watch)).toThrow(
        join(attic, ".flume"),
      );
      expect(() => refusePreexistingStateRoots(watch)).toThrow(/rm -rf/);
    } finally {
      await rm(attic, { recursive: true, force: true });
    }
  });

  it("is armed by vitest.config, in both lanes, at the host temp dir", async () => {
    const repoRoot = fileURLToPath(new URL("..", import.meta.url));
    const exported = (await import("../vitest.config.ts")).default;
    expect(typeof exported).toBe("function");
    const asFn = exported as (env: {
      command: "serve";
      mode: string;
    }) => Promise<{ test?: { setupFiles?: string | string[] } }>;

    for (const mode of ["test", "integration"]) {
      const config = await asFn({ command: "serve", mode });
      const declared = config.test?.setupFiles ?? [];
      const entries = typeof declared === "string" ? [declared] : declared;
      expect(entries.length).toBeGreaterThan(0);

      // Agreement, not restatement: whatever the config names is imported and
      // asked what it armed. A setup file that exists but installs nothing
      // fails here.
      const armed = await Promise.all(
        entries.map(
          (entry) =>
            import(resolve(repoRoot, entry)) as Promise<{
              ARMED_STATE_ROOT_WATCH?: { scope: readonly string[] };
            }>,
        ),
      );
      const scopes = armed.flatMap(
        (m) => m.ARMED_STATE_ROOT_WATCH?.scope ?? [],
      );
      expect(scopes).toContain(join(tmpdir(), ".flume"));
    }
  });
});
