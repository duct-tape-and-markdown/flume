/**
 * Agent — the seam between the dispatcher and an LLM CLI, and nothing else.
 *
 * The shapes a dispatcher and a provider agree on: an invocation, its result,
 * how the process behind it ended, the usage facts that result may carry, and
 * the `Agent` a chain hands a phase. No provider, no decorator, no transcript
 * alphabet — each of those is its own module, named at {@link Agent}. We deliberately do not
 * abstract over streaming, structured outputs, or session continuity; those
 * are non-goals.
 */

/**
 * One agent run, parameterized by cwd, prompt, and stream/abort hooks. The
 * dispatcher constructs one per tick (or one per worktree for fanout) and
 * hands it to `Agent.invoke`.
 */
export interface AgentInvocation {
  /** Working directory for the agent process. */
  cwd: string;
  /** Fully-rendered prompt (substitution + inline-exec already applied). */
  prompt: string;
  /**
   * Tag of the provisioned entry this invocation is running — the same fact
   * the tick verdict's `TickVerdictInvocation.entryTag` row carries, on the
   * one surface a decorator can read. A decorator is composed from a `Phase.agent`
   * getter that holds no `TickContext`, so this is the only place the tag is
   * reachable without re-parsing the rendered prompt.
   *
   * Set under fanout, absent under singleton — which provisions no entry and
   * so has no tag to state, the same rule the verdict row follows. Not the
   * worktree key: `WorktreeSetupContext.worktreeKey` falls back to the phase
   * name under singleton, where this field stays absent.
   */
  entryTag?: string;
  /**
   * Optional abort signal for cancellation — the dispatcher forwards the
   * tick's own stop signal here (`DispatcherOptions.stopSignal`), which is
   * how a signalled `flume tick` reaches the agent it started.
   *
   * A provider that aborts **takes its whole process tree down and settles on
   * that tree's exit**, never on the abort itself: the caller releases the
   * guards over the state root the moment this promise settles, so settling
   * early hands that root to the next acquirer with a live writer inside it
   * (spec/loop.md, "The loop lock and the tip claim").
   */
  signal?: AbortSignal;
  /**
   * Optional wall-clock timeout in milliseconds. When set, the provider must
   * abort the underlying process after this duration. Combined with `signal`
   * via `AbortSignal.any` if both are present — whichever fires first wins.
   * Callers that don't set either field accept that a hung agent will block
   * the invocation indefinitely.
   */
  timeoutMs?: number;
  /**
   * Milliseconds the aborted process tree gets between its SIGTERM and the
   * SIGKILL that follows — what bounds the wait `signal` and `timeoutMs`
   * above commit the provider to. The dispatcher forwards the chain's
   * `supervisorPolicy.killGraceMs` (`src/Phase.ts`) here, off the tick's own
   * resolved chain; absent takes `DEFAULT_KILL_GRACE_MS`
   * (`src/processTree.ts`). This is the only timer over a signalled tick
   * tree — a `flume loop` above signals its child and waits on it unbounded
   * (spec/loop.md, "The loop lock and the tip claim").
   */
  killGraceMs?: number;
  /**
   * Stream callback for stdout chunks. Chunks are NOT guaranteed to be
   * line-bounded — consumers that need lines must buffer and split on `\n`
   * themselves (see `withTerminalRenderer`, `src/terminalRender.ts`).
   */
  onStdout?: (chunk: string) => void;
  /** Stream callback for stderr chunks. Same chunk-boundary caveat as stdout. */
  onStderr?: (chunk: string) => void;
  /**
   * Extra env vars to layer on top of `process.env` for the agent
   * subprocess. The dispatcher populates this from the tick's
   * `Phase.setupWorktree` `{ extraEnv }` return value under either
   * concurrency — each provisions a worktree and runs the hook against it
   * (a fanout wave once per entry, a singleton tick once for its own
   * worktree; spec/worktrees.md "Singleton runs in a worktree"). Absent
   * when the phase declares no hook, or the hook returned no vars.
   */
  extraEnv?: Record<string, string>;
}

/**
 * Cost/telemetry facts read off a `claude -p --output-format stream-json`
 * `result` event — the whole of the one decode of that event
 * (`extractResultUsage`, `src/terminalRender.ts`), which the terminal's
 * result line is then rendered from (spec/loop.md "The tick verdict — one
 * facts artifact"). Which of these fields that line spells is
 * `formatResult`'s own answer, never a roster kept here: a chain reads the
 * shape off {@link AgentResult} whether the terminal printed a given figure
 * or not. Each field is present only when the event reported it; a field the
 * agent's result didn't carry is absent, never coerced to zero, on both
 * surfaces.
 */
export interface AgentUsage {
  /**
   * The `result` event's `modelUsage` key, when it names exactly one model.
   * `modelUsage` can carry more than one (an ancillary model alongside the
   * turn's primary one) — absent rather than guessed when it does, since
   * nothing on the event says which key is "the" model.
   */
  model?: string;
  turns?: number;
  durationMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
  /**
   * The `result` event's `total_cost_usd` — the cost the agent itself
   * reports for the invocation, lifted at the same decode as the token
   * fields so a chain wanting cost telemetry reads it here rather than
   * re-scanning raw stdout beside the engine.
   */
  costUsd?: number;
}

/**
 * How an agent process ended: the code it exited with, or — POSIX only — the
 * signal that ended it. Exactly one arm, enforced by the type, because the
 * record a preempt leaves has to carry the real ending and never a sentinel
 * standing in for the other arm (`spec/loop.md`, *The no-commit taxonomy*).
 *
 * The signal is the host's own name (`SIGKILL`, `SIGTERM`, …) as a plain
 * string: the set belongs to the platform, not to the engine, so a provider
 * on a host flume has never run on reports what that host said.
 */
export type AgentEnding =
  | { exitCode: number; signal?: undefined }
  | { exitCode: null; signal: string };

/**
 * The ending alone, projected off a value that also carries an invocation's
 * output — one home for the narrowing, so a caller persisting an ending does
 * not re-spell which arm goes with which field.
 */
export function agentEnding(result: AgentEnding): AgentEnding {
  return result.signal === undefined
    ? { exitCode: result.exitCode }
    : { exitCode: null, signal: result.signal };
}

/**
 * Read an {@link AgentEnding} off a value the engine did not mint — the key
 * an aborted invocation's rejection carries (`abortError`,
 * `src/claudeCode.ts`), which reaches its reader through chain code and so
 * arrives as `unknown`. Guarded on both arms rather than cast: a shape that
 * is not an ending yields `undefined`, which is the record's "no ending was
 * reported", never an ending assembled out of whatever was there.
 *
 * Each arm admits only an ending that *states* one. A code is an integer,
 * because `NaN` and `1.5` are numbers no exit produced; a signal has a name,
 * because the empty string renders as `was killed by signal .` into a retry's
 * prior-attempt block — a blank standing in for content that never resolved
 * (`.claude/rules/engineering.md`, *Loud or nothing*). Both read as no ending
 * reported, which is a statement the retry can act on.
 */
export function readAgentEnding(value: unknown): AgentEnding | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const { exitCode, signal } = value as { exitCode?: unknown; signal?: unknown };
  if (Number.isInteger(exitCode) && signal === undefined) {
    return { exitCode: exitCode as number };
  }
  if (exitCode === null && typeof signal === "string" && signal !== "") {
    return { exitCode: null, signal };
  }
  return undefined;
}

/**
 * An ending in words, for a failure class and for the prompt a retry reads.
 * The one spelling: a second one beside it is how a signature and the prose
 * it keys drift apart (`.claude/rules/engineering.md`, *Derived state is
 * computed, never restated beside its source*).
 */
export function agentEndingWords(ending: AgentEnding): string {
  return ending.signal === undefined
    ? `exited with code ${ending.exitCode}`
    : `was killed by signal ${ending.signal}`;
}

/**
 * Captured output of a single agent invocation, together with the
 * {@link AgentEnding} that closed it. Returned by `Agent.invoke` once the
 * process exits; the dispatcher reads the ending to classify a preempt, and
 * stdout/stderr are surfaced as a whole for debugging and decorators.
 */
export type AgentResult = AgentEnding & {
  /** Full captured stdout. */
  stdout: string;
  /** Full captured stderr. */
  stderr: string;
  /**
   * Usage/cost facts lifted from a stream-json `result` event, when the
   * wrapping `Agent` parses one (`withTerminalRenderer`,
   * `src/terminalRender.ts`). Absent for a plain-text agent, or when the
   * invocation's stdout carried no `result` event to read from.
   */
  usage?: AgentUsage;
  /**
   * The agent's closing prose, lifted from the full captured stdout by
   * `extractFinalMessage` (`src/claudeCode.ts`) — unbound, provider-specific
   * size policy (a persist-time bound like the dispatcher's `tailBound`) is
   * the caller's job, not the adapter's. A provider that doesn't implement
   * extraction leaves this absent; `claudeCode` always sets it.
   */
  finalMessage?: string;
};

/**
 * Provider seam. One implementation per LLM CLI, and `claudeCode`
 * (`src/claudeCode.ts`) is the only one this tree carries; a second exists
 * once some other CLI is adapted to this interface, which is an addition
 * there and no change to the dispatcher — that is what the interface buys.
 * Decorators (`withSessionCapture`, `src/sessionCapture.ts`;
 * `withTerminalRenderer`, `src/terminalRender.ts`) wrap an Agent and return
 * another Agent, so they compose without dispatcher help.
 */
export interface Agent {
  /** Stable identifier; appears in logs. */
  name: string;
  /** One invocation, no in-process iteration. */
  invoke(opts: AgentInvocation): Promise<AgentResult>;
}
