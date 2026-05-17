/**
 * Prompt — renders a phase's prompt file for one tick.
 *
 * Two transformations are applied to the raw file:
 *
 *   1. `{{KEY}}` placeholders are replaced from the promptArgs map.
 *   2. `` !`shell command` `` inline-exec blocks are evaluated in the tick's
 *      cwd and replaced with their stdout. This lets prompts bake in dynamic
 *      context (current `pending.json`, recent `git log`, `pnpm tsc` output)
 *      without an authoring round-trip.
 *
 * A `<harness>` block is prepended to every rendered prompt with the phase's
 * declared capabilities (writable paths, gate names). This keeps prompts DRY
 * — the human-authored prompt file states the task; the harness injects what
 * it will enforce.
 *
 * A `<prior-attempt>` block follows it whenever the dispatcher hands in a
 * persisted {@link PriorAttempt} — the bounded record of a previous attempt
 * that committed and was reverted by a gate. Like `<harness>` it is
 * dispatcher-owned and structural: no `{{token}}` in the prompt file, no
 * `promptArgs`. Absent on a first attempt; cleared once an attempt ships.
 */

import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";

import type { Phase } from "./Phase.js";

const exec = promisify(execFile);

const PLACEHOLDER_RE = /\{\{([A-Z][A-Z0-9_]*)\}\}/g;
const INLINE_EXEC_RE = /!\s*`([^`]+)`/g;

/**
 * A reverted prior attempt for one entry (fanout, keyed by tag) or phase
 * (singleton, keyed by phase name). The dispatcher persists this to disk on
 * a gate-revert and reads it back on the next tick — the carry is
 * cross-process by construction (each tick is a fresh process; there is no
 * in-memory handoff). Bounded by construction: a digest, not a transcript.
 */
export interface PriorAttempt {
  /** Which gate phase reverted the prior commit. */
  when: "afterCommit" | "afterMerge";
  /** Failing gate's stable `name`. */
  gate: string;
  /** Gate's one-line verdict (`GateResult.message`). */
  message: string;
  /** Gate's full captured output (`GateResult.details`), bounded. */
  details?: string;
  /** `git show --stat` digest of the reverted commit, bounded. */
  diffStat: string;
}

/**
 * Inputs to `renderPrompt`. The dispatcher resolves `promptFile` from the
 * chain's config directory plus `phase.promptPath`; `args` and `cwd` come
 * from the per-tick `TickContext` and the phase's `promptArgs` builder.
 */
export interface RenderOptions {
  phase: Phase;
  /** Resolved path of the prompt file (already joined with chain config dir). */
  promptFile: string;
  /** Working directory for inline-exec evaluation. */
  cwd: string;
  /** Substitution map. */
  args: Record<string, string>;
  /**
   * A prior reverted attempt for this entry/phase, read from disk by the
   * dispatcher. Injected as the dispatcher-owned `<prior-attempt>` block.
   * Omitted on a first attempt — the block is then absent entirely.
   */
  priorAttempt?: PriorAttempt;
}

/**
 * Resolve a phase's prompt file for one tick: substitute `{{KEY}}`
 * placeholders from `args`, evaluate `` !`cmd` `` inline-exec blocks in
 * `cwd`, prepend the optional `<prior-attempt>` block, then prepend the
 * `<harness>` block describing writable paths and gates. Returns the
 * fully-rendered prompt ready to feed an Agent. Block order in the result:
 * `<harness>` first, then `<prior-attempt>` (if any), then the task body —
 * what is enforced, then what failed last time, then the work.
 */
export async function renderPrompt(opts: RenderOptions): Promise<string> {
  const raw = await readFile(opts.promptFile, "utf8");
  const withArgs = substitutePlaceholders(raw, opts.args);
  const withExec = await evaluateInlineExec(withArgs, opts.cwd);
  const withPrior = prependPriorAttemptBlock(opts.priorAttempt, withExec);
  return prependHarnessBlock(opts.phase, withPrior);
}

// ---------- transformations ----------

function substitutePlaceholders(
  raw: string,
  args: Record<string, string>,
): string {
  const missing = new Set<string>();
  const result = raw.replace(PLACEHOLDER_RE, (_, key: string) => {
    if (key in args) return args[key]!;
    missing.add(key);
    return `{{${key}}}`; // leave as-is so the failure surfaces
  });
  if (missing.size > 0) {
    throw new Error(
      `prompt references missing args: ${[...missing].sort().join(", ")}`,
    );
  }
  return result;
}

async function evaluateInlineExec(raw: string, cwd: string): Promise<string> {
  // Collect all matches first so we can run them in parallel.
  const matches = [...raw.matchAll(INLINE_EXEC_RE)];
  if (matches.length === 0) return raw;

  const results = await Promise.all(
    matches.map(async (m) => {
      const cmd = m[1]!.trim();
      try {
        const { stdout } = await exec("sh", ["-c", cmd], {
          cwd,
          maxBuffer: 4 * 1024 * 1024,
        });
        return { match: m[0], replacement: stdout.trimEnd() };
      } catch (err) {
        const e = err as { stdout?: string; stderr?: string; message: string };
        return {
          match: m[0],
          replacement: `<exec-failed cmd="${cmd}">${
            e.stderr ?? e.message
          }</exec-failed>`,
        };
      }
    }),
  );

  // Replace by walking the original string with computed offsets — multiple
  // matches with the same text would otherwise alias on naive String.replace.
  let out = "";
  let cursor = 0;
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i]!;
    const start = m.index!;
    out += raw.slice(cursor, start) + results[i]!.replacement;
    cursor = start + m[0].length;
  }
  out += raw.slice(cursor);
  return out;
}

function prependHarnessBlock(phase: Phase, body: string): string {
  const gateLines = phase.gates
    .map((g) => `  - ${g.name} (${g.when})`)
    .join("\n");
  const pathLines = phase.writablePaths.map((p) => `  - ${p}`).join("\n");

  const harness = [
    `<harness>`,
    `Phase: ${phase.name}`,
    `Concurrency: ${phase.concurrency}`,
    `Writable paths (anything else you modify will revert the commit):`,
    pathLines,
    `Gates (run automatically after your commit):`,
    gateLines || "  (none)",
    `</harness>`,
    "",
  ].join("\n");

  return harness + body;
}

function indentBlock(s: string): string {
  const trimmed = s.replace(/\s+$/, "");
  if (trimmed.length === 0) return "  (none)";
  return trimmed
    .split("\n")
    .map((l) => `  ${l}`)
    .join("\n");
}

/**
 * Prepend the dispatcher-owned `<prior-attempt>` block. Mirrors
 * `prependHarnessBlock`: structural, not authored — there is no `{{token}}`
 * for it in the prompt file. Absent (identity transform) on a first attempt,
 * so the slot carries no false signal. When present it tells the retrying
 * tick a prior commit was gate-reverted, names the gate and its full
 * details, and gives a bounded digest of the reverted change so the agent
 * does not blindly reconstruct the wall it already hit.
 */
function prependPriorAttemptBlock(
  prior: PriorAttempt | undefined,
  body: string,
): string {
  if (!prior) return body;

  const block = [
    `<prior-attempt>`,
    `A previous attempt at this work committed and was REVERTED by a gate.`,
    `Read the failure below and change your approach — do not blindly`,
    `reconstruct the reverted change.`,
    `Reverted at: ${prior.when}`,
    `Failing gate: ${prior.gate}`,
    `Verdict: ${prior.message}`,
    `Gate details:`,
    indentBlock(prior.details ?? ""),
    `Reverted change digest (git show --stat):`,
    indentBlock(prior.diffStat),
    `</prior-attempt>`,
    "",
  ].join("\n");

  return block + body;
}
