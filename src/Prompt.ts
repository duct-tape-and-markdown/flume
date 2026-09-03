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
 * attempt, tagged with exactly one of the four causally-distinct modes
 * (§6 no-commit taxonomy, widened by RELEASE-v0.10 §3): `gate-revert`
 * (committed then a gate reverted it), `voluntary-bail` (exited cleanly
 * refusing a constraint), `platform-preempt` (the process failed for
 * non-work reasons — not a defect in the work), `render-refused` (the prompt
 * itself never resolved — the agent was never invoked); plus `tip-moved`
 * (RELEASE-v0.11 §5), a sibling fact rather than a fifth {@link NoCommitMode}
 * — the tick's commit was discarded because the ref moved out from under it,
 * never a defect the four modes classify. Each renders distinctly so the
 * retry knows what actually happened. Like `<harness>` it is
 * dispatcher-owned and structural: no `{{token}}` in the prompt file, no
 * `promptArgs`. Absent on a first attempt; cleared once an attempt ships.
 */

import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";

import type { Phase } from "./Phase.js";
import { entryWriteScopeUnion } from "./paths.js";
import { declaredPaths, type PendingEntry } from "./PendingSchema.js";

const PLACEHOLDER_RE = /\{\{([A-Z][A-Z0-9_]*)\}\}/g;
const INLINE_EXEC_RE = /!\s*`([^`]+)`/g;

/**
 * Output cap for one inline-exec span (RELEASE-v0.10 §2). `spawn` has no
 * `maxBuffer` (unlike `execFile`), so the cap is enforced by hand: overrun
 * kills the child and rejects rather than truncating silently.
 */
const INLINE_EXEC_MAX_BUFFER = 4 * 1024 * 1024;

/**
 * The four causally-distinct ways a tick produces no usable commit (§6,
 * widened by RELEASE-v0.10 §3). The discriminant of {@link PriorAttempt} and
 * the value carried on `TickOutcome.noCommit`; exactly one per no-commit
 * tick.
 */
export type NoCommitMode =
  | "gate-revert"
  | "voluntary-bail"
  | "platform-preempt"
  | "render-refused";

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
  /**
   * Set when the gate's `failingFiles` (`GateResult.failingFiles`) is present
   * and every entry in it is disjoint from the reverted span's own touched
   * paths — derived mechanically by the dispatcher, never inferred from gate
   * prose (spec/chain.md "What a gate returns"). Absent when either list is
   * missing or the lists overlap: an absent field is never read as flaky.
   */
  suspectFlake?: boolean;
  /** Trunk tip when this record was written (spec/loop.md "Every record is anchored"). */
  headSha: string;
  /** ISO timestamp alongside {@link headSha}. */
  at: string;
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
  /** Trunk tip when this record was written (spec/loop.md "Every record is anchored"). */
  headSha: string;
  /** ISO timestamp alongside {@link headSha}. */
  at: string;
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
  /** Trunk tip when this record was written (spec/loop.md "Every record is anchored"). */
  headSha: string;
  /** ISO timestamp alongside {@link headSha}. */
  at: string;
}

/**
 * The render aborted before the agent was invoked — one or more inline-exec
 * spans in the prompt did not resolve (RELEASE-v0.10 §3). Distinct from
 * `voluntary-bail` (the agent ran and chose not to commit) and from
 * `platform-preempt` (the agent process itself failed): here the agent never
 * ran at all, so a chain's `handoff` can tell "could not see" from "chose
 * not to act".
 */
export interface RenderRefusedAttempt {
  mode: "render-refused";
  /** Every failing span's command text and stderr, bounded. */
  failures: string;
  /** Trunk tip when this record was written (spec/loop.md "Every record is anchored"). */
  headSha: string;
  /** ISO timestamp alongside {@link headSha}. */
  at: string;
}

/**
 * The tick's commit was discarded because the ref moved between tick start
 * and the point a commit would land onto it (RELEASE-v0.11 §5) — the
 * dispatcher's own tip-verify backstop, not a {@link NoCommitMode}: the
 * agent's (or harness's) work was not at fault, and no gate ran. A sibling
 * fact beside the four `NoCommitMode` variants, not a fifth member of that
 * type — `mode` here is its own literal, `"tip-moved"`, never assigned to a
 * `NoCommitMode`-typed field.
 */
export interface TipMovedAttempt {
  mode: "tip-moved";
  /** Tip this tick recorded at tick start. */
  expectedTip: string;
  /** Tip the harness actually found immediately before it would have committed. */
  observedTip: string;
  /** Trunk tip when this record was written (spec/loop.md "Every record is anchored"). */
  headSha: string;
  /** ISO timestamp alongside {@link headSha}. */
  at: string;
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
  | PlatformPreemptAttempt
  | RenderRefusedAttempt
  | TipMovedAttempt;

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
   * assignment) renders the unscoped block — exact byte shape pinned by
   * tests/Prompt.test.ts's "byte-identical to the pre-§2 collapsed
   * rendering" case.
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

/** One inline-exec span that failed to resolve — its command text and stderr. */
export interface InlineExecFailure {
  cmd: string;
  stderr: string;
}

/**
 * Thrown by {@link evaluateInlineExec} when at least one inline-exec span
 * cannot be resolved (non-zero exit, spawn failure, `sh` not found, cap
 * overrun) — RELEASE-v0.10 §3: the render aborts and the agent is never
 * invoked. `message` names every failing span's command text and stderr, so
 * a caller that just logs `.message` (rather than reading `.failures`) still
 * surfaces the full picture.
 */
export class InlineExecRenderError extends Error {
  readonly failures: InlineExecFailure[];

  constructor(failures: InlineExecFailure[]) {
    super(
      [
        `prompt render aborted: ${failures.length} inline-exec span(s) failed to resolve`,
        ...failures.map((f) => `  cmd: ${f.cmd}\n  stderr: ${f.stderr}`),
      ].join("\n"),
    );
    this.name = "InlineExecRenderError";
    this.failures = failures;
  }
}

type InlineExecOutcome =
  | { ok: true; match: string; replacement: string }
  | { ok: false; match: string; cmd: string; stderr: string };

async function evaluateInlineExec(raw: string, cwd: string): Promise<string> {
  // Collect all matches first so we can run them in parallel.
  const matches = [...raw.matchAll(INLINE_EXEC_RE)];
  if (matches.length === 0) return raw;

  const results: InlineExecOutcome[] = await Promise.all(
    matches.map(async (m): Promise<InlineExecOutcome> => {
      const cmd = m[1]!.trim();
      try {
        const { stdout } = await runInlineExec(cmd, cwd);
        return { ok: true, match: m[0], replacement: stdout.trimEnd() };
      } catch (err) {
        const e = err as { stdout?: string; stderr?: string; message: string };
        return { ok: false, match: m[0], cmd, stderr: e.stderr ?? e.message };
      }
    }),
  );

  // Loud or nothing (RELEASE-v0.10 §3): any unresolved span aborts the whole
  // render before the agent is invoked — no substituted marker standing in
  // for output that never came.
  const failures = results.filter((r): r is Extract<InlineExecOutcome, { ok: false }> => !r.ok);
  if (failures.length > 0) {
    throw new InlineExecRenderError(
      failures.map((f) => ({ cmd: f.cmd, stderr: f.stderr })),
    );
  }

  // Replace by walking the original string with computed offsets — multiple
  // matches with the same text would otherwise alias on naive String.replace.
  let out = "";
  let cursor = 0;
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i]!;
    const start = m.index!;
    out += raw.slice(cursor, start) + (results[i] as Extract<InlineExecOutcome, { ok: true }>).replacement;
    cursor = start + m[0].length;
  }
  out += raw.slice(cursor);
  return out;
}

/**
 * Evaluate one inline-exec command: spawn `sh` with no command argv and
 * write `cmd` to its stdin as UTF-8, then close it (RELEASE-v0.10 §2).
 * Measured (spec §1): `["-c", cmd]` corrupts any non-ASCII byte on win32
 * under MSYS2's re-parsing of the Windows command line — stdin transport
 * does not. `sh` consumes stdin, so a span whose command itself reads
 * stdin sees EOF; no span in this repo's prompts does.
 */
function runInlineExec(
  cmd: string,
  cwd: string,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn("sh", [], { cwd });
    let stdout = Buffer.alloc(0);
    let stderr = Buffer.alloc(0);
    let settled = false;

    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      child.kill();
      reject(err);
    };

    const capture =
      (target: "stdout" | "stderr") => (chunk: Buffer): void => {
        if (settled) return;
        const prior = target === "stdout" ? stdout : stderr;
        const next = Buffer.concat([prior, chunk]);
        if (next.length > INLINE_EXEC_MAX_BUFFER) {
          fail(
            new Error(
              `inline-exec output exceeded ${INLINE_EXEC_MAX_BUFFER} bytes: ${cmd}`,
            ),
          );
          return;
        }
        if (target === "stdout") stdout = next;
        else stderr = next;
      };

    child.stdout.on("data", capture("stdout"));
    child.stderr.on("data", capture("stderr"));
    child.on("error", fail);
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      if (code === 0) {
        resolve({
          stdout: stdout.toString("utf8"),
          stderr: stderr.toString("utf8"),
        });
      } else {
        reject(
          Object.assign(new Error(`sh exited ${code}`), {
            stdout: stdout.toString("utf8"),
            stderr: stderr.toString("utf8"),
          }),
        );
      }
    });

    child.stdin.end(cmd, "utf8");
  });
}

function prependHarnessBlock(
  phase: Phase,
  assignedEntry: PendingEntry | undefined,
  body: string,
): string {
  const gateLines = phase.gates
    .map((g) => `  - ${g.name} (${g.when})` + (g.command ? `: ${g.command}` : ""))
    .join("\n");

  const harness = [
    `<harness>`,
    `Phase: ${phase.name}`,
    `Concurrency: ${phase.concurrency}`,
    ...(assignedEntry && phase.scopeWritesToEntry
      ? effectiveFenceLines(phase, assignedEntry)
      : unscopedFenceLines(phase)),
    `Gates (run automatically after your commit):`,
    gateLines || "  (none)",
    `</harness>`,
    "",
  ].join("\n");

  return harness + body;
}

/**
 * Unscoped rendering. Byte shape pinned by tests/Prompt.test.ts's
 * "byte-identical to the pre-§2 collapsed rendering" case.
 */
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
 * and the guard's ceiling check must clear. Sources the union from
 * `entryWriteScopeUnion` (`src/paths.ts`), the same helper the
 * `writablePathsGate` entry-scope check consumes, so the two can never
 * state a different fence.
 */
function effectiveFenceLines(phase: Phase, entry: PendingEntry): string[] {
  const entryPaths = declaredPaths(entry);
  const fence = entryWriteScopeUnion(entryPaths, phase.entryChannelPaths ?? []);
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

/**
 * The `<prior-attempt>` block body: the mode-specific lines, followed by the
 * anchor every variant now carries (spec/loop.md "Every record is
 * anchored") — one shared trailer rather than repeating it per case.
 */
function priorAttemptLines(prior: PriorAttempt): string[] {
  return [
    ...modeLines(prior),
    `Recorded ${prior.at}, trunk tip ${prior.headSha}.`,
  ];
}

/** The mode-specific body of the `<prior-attempt>` block. Exhaustive over the union. */
function modeLines(prior: PriorAttempt): string[] {
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
    case "render-refused":
      return [
        `A previous attempt's prompt could not even be rendered — one or`,
        `more inline-exec spans failed to resolve, so the agent was NEVER`,
        `invoked. This is not a voluntary bail and not a platform failure:`,
        `something in the prompt itself is broken. Fix or remove the failing`,
        `command(s) before retrying.`,
        `Failing span(s):`,
        indentBlock(prior.failures),
      ];
    case "tip-moved":
      return [
        `A previous attempt's commit was DISCARDED because the ref moved`,
        `out from under it — NOT a defect in the work. The prior reasoning`,
        `is not discredited; do not treat this as a wall in the task.`,
        `Resume the work against the current tip. No commit, no gate.`,
        `Tip expected at tick start: ${prior.expectedTip}`,
        `Tip actually found: ${prior.observedTip}`,
      ];
  }
}
