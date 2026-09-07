/**
 * SUBPROCESS-TSX-SENTINEL — the shared CLI-subprocess harness's own suite.
 * Every other CLI suite *consumes* `tests/helpers/subprocess.ts`; this one
 * tests it, because the helper is where a CLI that never started used to
 * become an ordinary exit code 1 (`.claude/rules/engineering.md`, "A green
 * verdict is proven non-vacuous").
 */

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CLI,
  TSX_CLI,
  exitStatusOf,
  requireEntryPoint,
  runCli,
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
