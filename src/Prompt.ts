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
 * persisted {@link PriorAttempt} — the bounded record of a previous no-commit
 * attempt, tagged with exactly one of the three causally-distinct modes
 * (§6 no-commit taxonomy): `gate-revert` (committed then a gate reverted it),
 * `voluntary-bail` (exited cleanly refusing a constraint), `platform-preempt`
 * (the process failed for non-work reasons — not a defect in the work). Each
 * renders distinctly so the retry knows what actually happened. Like
 * `<harness>` it is dispatcher-owned and structural: no `{{token}}` in the
 * prompt file, no `promptArgs`. Absent on a first attempt; cleared once an
 * attempt ships.
 */

import { readFile } from "node:fs/promises";

import { execGate } from "./builtinGates.js";
import type { Phase } from "./Phase.js";
import type { PendingEntry } from "./PendingSchema.js";

const PLACEHOLDER_RE = /\{\{([A-Z][A-Z0-9_]*)\}\}/g;
const INLINE_EXEC_RE = /!\s*`([^`]+)`/g;

/**
 * The three causally-distinct ways a tick produces no usable commit (§6).
 * The discriminant of {@link PriorAttempt} and the value carried on
 * `TickOutcome.noCommit`; exactly one per no-commit tick.
 */
export type NoCommitMode = "gate-revert" | "voluntary-bail" | "platform-preempt";

/**
 * A prior attempt that committed and was then REVERTED by a gate
 * (`afterCommit` or `afterMerge`). The only variant shipped at §5; §6 widens
 * the union around it without reshaping it.
 */
export interface GateRevertAttempt {
  mode: "gate-revert";
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
 * The agent exited cleanly without committing — it refused to cross a
 * constraint rather than do the wrong thing. No commit, no gate; the prior
 * judgment likely still holds, so the retry must resolve or escalate the
 * constraint, not blindly re-run the same edit.
 */
export interface VoluntaryBailAttempt {
  mode: "voluntary-bail";
  /**
   * The constraint the prior attempt refused to cross (off-`writablePaths`
   * path, Rule-0 / spec conflict) — the agent's final message, bounded. The
   * build/plan prompts instruct the agent to state the gap in that message
   * on a bail, so its tail is where the constraint is named.
   */
  constraint: string;
}

/**
 * The agent process failed for non-work reasons (rate-limit, auth, per-tick
 * timeout, dispatcher-killed). Explicitly NOT a defect in the prior
 * attempt's work — its reasoning is not discredited; the retry resumes the
 * work rather than treating the cut-off as a wall.
 */
export interface PlatformPreemptAttempt {
  mode: "platform-preempt";
  /** The non-work failure class, bounded. */
  failureClass: string;
}

/**
 * A prior no-commit attempt for one entry (fanout, keyed by tag) or phase
 * (singleton, keyed by phase name) — a mode-tagged union, exactly one
 * variant. The dispatcher persists this to disk when a tick yields no usable
 * commit and reads it back on the next tick: the carry is cross-process by
 * construction (each tick is a fresh process; there is no in-memory
 * handoff). Bounded by construction: a digest, not a transcript.
 */
export type PriorAttempt =
  | GateRevertAttempt
  | VoluntaryBailAttempt
  | PlatformPreemptAttempt;

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
  /**
   * Resolved flume state root. Auto-injected as the reserved `{{FLUME_DIR}}`
   * substitution key, so any prompt can reference state-relative paths
   * (`{{FLUME_DIR}}/plan/pending.json`) with no `promptArgs` boilerplate. A
   * chain-supplied `FLUME_DIR` in `args` does not override it — the resolved
   * root is authoritative (RELEASE-v0.3 §16).
   */
  flumeDir: string;
  /** Substitution map. */
  args: Record<string, string>;
  /**
   * A prior no-commit attempt for this entry/phase (any of the three §6
   * modes), read from disk by the dispatcher. Injected as the
   * dispatcher-owned `<prior-attempt>` block. Omitted on a first attempt —
   * the block is then absent entirely.
   */
  priorAttempt?: PriorAttempt;
  /**
   * Pending entry assigned to this tick (fanout phases only), read from the
   * same `TickContext` the dispatcher already threads through. When present,
   * the `<harness>` block states the *effective* fence — `entry.files ∪
   * phase.entryChannelPaths` — as what the write guard
   * (`src/Dispatcher.ts` `runAfterCommitGates`) actually enforces on this
   * tick, naming `phase.writablePaths` separately as the outer ceiling
   * (RELEASE-v0.7 §2). Absent (singleton ticks, or a fanout tick with no
   * assignment) renders the unscoped, byte-identical-to-0.6.2 block.
   */
  assignedEntry?: PendingEntry;
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
  // FLUME_DIR is reserved and dispatcher-authoritative: merge it last so a
  // chain-supplied arg of the same name cannot shadow the resolved root.
  const args = { ...opts.args, FLUME_DIR: opts.flumeDir };
  const withArgs = substitutePlaceholders(raw, args);
  const withExec = await evaluateInlineExec(withArgs, opts.cwd);
  const withPrior = prependPriorAttemptBlock(opts.priorAttempt, withExec);
  return prependHarnessBlock(opts.phase, opts.assignedEntry, withPrior);
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
        const { stdout } = await execGate("sh", ["-c", cmd], {
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

function prependHarnessBlock(
  phase: Phase,
  assignedEntry: PendingEntry | undefined,
  body: string,
): string {
  const gateLines = phase.gates
    .map((g) => `  - ${g.name} (${g.when})`)
    .join("\n");

  const harness = [
    `<harness>`,
    `Phase: ${phase.name}`,
    `Concurrency: ${phase.concurrency}`,
    ...(assignedEntry
      ? effectiveFenceLines(phase, assignedEntry)
      : unscopedFenceLines(phase)),
    `Gates (run automatically after your commit):`,
    gateLines || "  (none)",
    `</harness>`,
    "",
  ].join("\n");

  return harness + body;
}

/** Unscoped rendering — byte-identical to the pre-§2 collapsed block. */
function unscopedFenceLines(phase: Phase): string[] {
  const pathLines = phase.writablePaths.map((p) => `  - ${p}`).join("\n");
  return [
    `Writable paths (anything else you modify will revert the commit):`,
    pathLines,
  ];
}

/**
 * Scoped rendering (RELEASE-v0.7 §2): states the fence the write guard
 * actually enforces on this tick — `entry.files ∪ phase.entryChannelPaths` —
 * separately from `phase.writablePaths`, the outer ceiling both this fence
 * and the guard's ceiling check must clear. Mirrors the same union
 * `runAfterCommitGates` (`src/Dispatcher.ts`) builds for the `writablePathsGate`
 * entry-scope check, so the two can never state a different fence.
 */
function effectiveFenceLines(phase: Phase, entry: PendingEntry): string[] {
  const entryPaths = [
    ...entry.files.new.map((f) => f.path),
    ...entry.files.edit.map((f) => f.path),
    ...entry.files.retire,
  ];
  const fence = [...new Set([...entryPaths, ...(phase.entryChannelPaths ?? [])])];
  const ceilingLines = phase.writablePaths.map((p) => `  - ${p}`).join("\n");

  return [
    `Effective fence (your commit may touch exactly these; anything else reverts the commit whole):`,
    fence.map((p) => `  - ${p}`).join("\n") || "  (none)",
    `Outer ceiling (also enforced, independently of the fence above — a path must clear both):`,
    ceilingLines,
  ];
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
 * tick exactly which of the three §6 no-commit modes the prior attempt hit,
 * rendered distinctly per variant so the agent reads what actually happened
 * — a reverted commit, a refused constraint, or a platform cut-off that is
 * explicitly NOT its predecessor's fault — rather than blindly reconstructing
 * a wall that may not exist.
 */
function prependPriorAttemptBlock(
  prior: PriorAttempt | undefined,
  body: string,
): string {
  if (!prior) return body;

  const block = [
    `<prior-attempt>`,
    ...priorAttemptLines(prior),
    `</prior-attempt>`,
    "",
  ].join("\n");

  return block + body;
}

/** The mode-specific body of the `<prior-attempt>` block. Exhaustive over the union. */
function priorAttemptLines(prior: PriorAttempt): string[] {
  switch (prior.mode) {
    case "gate-revert":
      return [
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
      ];
    case "voluntary-bail":
      return [
        `A previous attempt exited deliberately WITHOUT committing — it`,
        `refused to cross the constraint below rather than do the wrong`,
        `thing. That judgment likely still holds: resolve the constraint or`,
        `escalate it, do not just re-run the same edit. No commit, no gate.`,
        `Refused constraint (prior attempt's final message):`,
        indentBlock(prior.constraint),
      ];
    case "platform-preempt":
      return [
        `A previous attempt was cut short by a PLATFORM failure — NOT a`,
        `defect in the work. The prior reasoning is not discredited; do not`,
        `treat this as a wall in the task. Resume the work. No commit, no gate.`,
        `Failure class (not your fault):`,
        indentBlock(prior.failureClass),
      ];
  }
}
