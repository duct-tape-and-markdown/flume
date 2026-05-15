/**
 * builtinGates — the gates everyone reaches for. Lifted from
 * `examples/cascade-chain.ts` once their shape stabilized.
 *
 * The set is intentionally small. `shellGate` is the escape hatch for any
 * project-specific check; promote new gates here only when ≥2 chains want them.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type { Gate, GateContext, GateResult, GatePhase } from "./Gate.ts";

const exec = promisify(execFile);

/**
 * Inputs for `shellGate`. The gate spawns `cmd` with `args` in the
 * worktree's cwd; non-zero exit = fail. `failHint` is the message surfaced
 * to the dispatcher on failure (and embedded in the next agent prompt's
 * gate-failure context).
 */
export interface ShellGateOptions {
  name: string;
  when: GatePhase;
  cmd: string;
  args: string[];
  /** Maximum bytes captured from stdout+stderr. Default 16 MiB. */
  maxBuffer?: number;
  /** Hint surfaced when the gate fails. Defaults to "<name> failed". */
  failHint?: string;
}

/**
 * Generic gate that shells out and reports green/fail by exit code.
 * Captures stdout+stderr up to `maxBuffer` (default 16 MiB) and surfaces
 * them as `GateResult.details` so the dispatcher can route them to the
 * logger or back to the agent as context on the next tick.
 */
export function shellGate(opts: ShellGateOptions): Gate {
  return {
    name: opts.name,
    when: opts.when,
    async run(ctx: GateContext): Promise<GateResult> {
      try {
        const { stdout, stderr } = await exec(opts.cmd, opts.args, {
          cwd: ctx.cwd,
          maxBuffer: opts.maxBuffer ?? 16 * 1024 * 1024,
        });
        return {
          ok: true,
          message: `${opts.name} green`,
          details: stdout || stderr,
        };
      } catch (err) {
        const e = err as { stdout?: string; stderr?: string; message: string };
        return {
          ok: false,
          message: opts.failHint ?? `${opts.name} failed`,
          details: (e.stderr ?? "") + (e.stdout ?? "") || e.message,
        };
      }
    },
  };
}

/**
 * `pnpm tsc --noEmit` after the agent's commit. Catches type errors before
 * the commit ships; on failure the dispatcher drops the commit and the
 * pending entry stays in queue for the next tick.
 */
export const tscGate: Gate = shellGate({
  name: "tsc",
  when: "afterCommit",
  cmd: "pnpm",
  args: ["tsc", "--noEmit"],
  failHint: "TypeScript errors — commit reverted",
});

/**
 * `pnpm test --run` (vitest non-watch) after the agent's commit. A red
 * suite reverts the commit; pair with `tscGate` (run first) so type errors
 * are caught before vitest even attempts to load the changed module.
 */
export const vitestGate: Gate = shellGate({
  name: "vitest",
  when: "afterCommit",
  cmd: "pnpm",
  args: ["test", "--run"],
  failHint: "Tests failed — commit reverted",
});

/**
 * `pnpm lint` (ESLint) after the agent's commit. Opt-in: only meaningful
 * for chains that wire `scripts.lint` in their `package.json`. Failures
 * revert the commit just like the other afterCommit gates.
 */
export const eslintGate: Gate = shellGate({
  name: "eslint",
  when: "afterCommit",
  cmd: "pnpm",
  args: ["lint"],
  failHint: "Lint errors — commit reverted",
});

/**
 * Verify the commit's diff stays inside the phase's declared writablePaths.
 * Constructed at runtime by the dispatcher because it needs the path globs.
 *
 * Implementation note: we don't ship this as a static export because it
 * depends on the phase config. The dispatcher attaches it automatically.
 */
export function writablePathsGate(globs: string[]): Gate {
  return {
    name: "writable-paths",
    when: "afterCommit",
    async run(ctx) {
      if (!ctx.commitSha) {
        return {
          ok: false,
          message: "writable-paths gate requires commitSha",
        };
      }
      const { stdout } = await exec(
        "git",
        ["show", "--name-only", "--pretty=format:", ctx.commitSha],
        { cwd: ctx.cwd },
      );
      const touched = stdout.split("\n").filter((l) => l.length > 0);
      const violations = touched.filter((p) => !matchesAny(p, globs));
      if (violations.length === 0) {
        return { ok: true, message: "writable paths respected" };
      }
      return {
        ok: false,
        message: `commit touched ${violations.length} path(s) outside writablePaths`,
        details: violations.map((p) => `  - ${p}`).join("\n"),
      };
    },
  };
}

// ---------- glob matching ----------

/**
 * Minimal glob matcher supporting `*`, `**`, and literal paths. We avoid a
 * dependency here so the harness has zero runtime deps beyond zod.
 */
function matchesAny(path: string, globs: string[]): boolean {
  return globs.some((g) => globToRegex(g).test(path));
}

function globToRegex(glob: string): RegExp {
  // Order matters: replace `**` before `*` to avoid overlap.
  const re = glob
    .replace(/[.+^${}()|[\]\\]/g, "\\$&") // escape regex specials
    .replace(/\*\*/g, "::DOUBLESTAR::")
    .replace(/\*/g, "[^/]*")
    .replace(/::DOUBLESTAR::/g, ".*");
  return new RegExp(`^${re}$`);
}
