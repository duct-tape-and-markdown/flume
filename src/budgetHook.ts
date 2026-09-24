/**
 * The adapter's own budget hook — the script `claudeCode({ budget })`
 * registers on one invocation's settings, and the vocabulary the adapter
 * spells that registration in (`spec/chain.md`, *The agent seam*).
 *
 * Two halves of one seam, so they share a file: the adapter renders a
 * declaration into the hook's argv, and this script parses it back. Split
 * across two modules the flags would be spelled twice, and a chain's
 * thresholds would reach the running hook only by the coincidence that both
 * spellings still agree (`.claude/rules/engineering.md`, *A seam gate reads
 * what the real writer wrote*).
 *
 * The hook is stateless. Everything it reports is read off the session
 * transcript the provider names in its input — `readBudgetLine`
 * (`src/budgetLine.ts`) does that reading — so nothing has to survive
 * between two tool calls, and the adapter passes it only what the chain
 * declared and the transcript cannot hold: the model's context window, the
 * cadence, and the thresholds.
 *
 * Facts, never a verdict. The line states context, clock and calls; what an
 * agent does at eighty percent of its window is the prompt's to say
 * (`spec/harness.md`, *A tick puts work down*).
 */

import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

import { readBudgetLine, type BudgetReading } from "./budgetLine.js";

/**
 * What a chain declares as `ClaudeCodeOptions.budget` — the facts about the
 * agent's room that no transcript states, and the cadence the line is handed
 * on.
 *
 * Every field is optional, and each one narrows: a declared budget with none
 * of them reports on every tool call with the clock and the call count
 * alone. That is the absence of a filter rather than a recommended cadence —
 * the engine holds no opinion about how often an agent should be told, and
 * no field here carries a default it chose (`.claude/rules/engine-boundary.md`,
 * *Surface, not prescription*).
 */
export interface BudgetDeclaration {
  /**
   * The model's context window in tokens. Declared rather than looked up: a
   * model's context size is a provider fact the engine does not hold.
   * Undeclared, the line states elapsed and calls alone — a token count has
   * nothing to be reported against — and {@link BudgetDeclaration.thresholds}
   * is refused with it.
   */
  contextWindow?: number;
  /**
   * Report on every Nth tool call. Undeclared, every call reports; a
   * threshold is what fills the gaps a sparse cadence leaves.
   */
  everyCalls?: number;
  /**
   * Fractions of the declared window — 0.7 for seventy percent — each
   * reported once, on the turn that crosses it. Needs a window: without one
   * there is no fraction to compare against, so declaring these alone is
   * refused rather than carried as an arm that never fires
   * ({@link validateBudget}).
   */
  thresholds?: number[];
}

/**
 * The flags the adapter writes and this module reads back. Named constants
 * because both halves of the seam spell them, and a flag renamed on one side
 * alone is a hook that silently reports on a cadence nobody declared.
 */
const CONTEXT_WINDOW_FLAG = "--context-window";
const EVERY_CALLS_FLAG = "--every-calls";
const THRESHOLDS_FLAG = "--thresholds";

/**
 * The provider's event this hook runs on. One declaration because both ends
 * of the registration spell it: the settings key the adapter arms the hook
 * under (`budgetSettings`, `src/Agent.ts`) and the `hookEventName` the hook
 * echoes back to claim its output. The provider matches the two, so an event
 * renamed on one side alone is a line the agent's next turn never sees, with
 * nothing failing to say so.
 */
export const HOOK_EVENT_NAME = "PostToolUse";

/** This module's own path — the script the rendered command invokes. */
const HOOK_MODULE_PATH = fileURLToPath(import.meta.url);

/**
 * A declaration checked for the values it can be read on, and for the fields
 * that need each other, or a throw naming the field at fault.
 *
 * Run by the adapter as the agent is built, so a chain that declared a
 * window of zero learns at chain-build time rather than once per tool call,
 * through a hook whose stderr nothing reads
 * (`.claude/rules/engineering.md`, *Loud or nothing*).
 */
export function validateBudget(budget: BudgetDeclaration): BudgetDeclaration {
  const positive = (field: string, value: number): void => {
    if (!Number.isFinite(value) || value <= 0) {
      throw new Error(
        `budget: ${field} must be a positive number, got ${value}`,
      );
    }
  };
  if (budget.contextWindow !== undefined) {
    positive("contextWindow", budget.contextWindow);
  }
  if (budget.everyCalls !== undefined) {
    positive("everyCalls", budget.everyCalls);
    if (!Number.isInteger(budget.everyCalls)) {
      throw new Error(
        `budget: everyCalls must be a whole number of tool calls, got ${budget.everyCalls}`,
      );
    }
  }
  const thresholds = budget.thresholds ?? [];
  for (const threshold of thresholds) {
    if (!Number.isFinite(threshold) || threshold <= 0 || threshold > 1) {
      throw new Error(
        `budget: each threshold must be a fraction of the window in (0, 1], got ${threshold}`,
      );
    }
  }
  // A threshold is a fraction of the window, so with no window declared there
  // is nothing to take a fraction of: every crossing arm is unreachable, and
  // the chain that asked to be told at seventy percent would be told nothing,
  // on a line that still looks like the one it declared.
  if (thresholds.length > 0 && budget.contextWindow === undefined) {
    throw new Error(
      "budget: thresholds are fractions of contextWindow, which was not declared, so none of them can ever fire",
    );
  }
  return budget;
}

/** A declaration as the hook's argv carries it, flags in declaration order. */
export function budgetHookArgs(budget: BudgetDeclaration): string[] {
  const args: string[] = [];
  if (budget.contextWindow !== undefined) {
    args.push(CONTEXT_WINDOW_FLAG, String(budget.contextWindow));
  }
  if (budget.everyCalls !== undefined) {
    args.push(EVERY_CALLS_FLAG, String(budget.everyCalls));
  }
  const thresholds = budget.thresholds ?? [];
  if (thresholds.length > 0) {
    args.push(THRESHOLDS_FLAG, thresholds.map(String).join(","));
  }
  return args;
}

/**
 * The other half: the declaration this hook was invoked with, read back off
 * its own argv and held to the same check the adapter ran.
 *
 * An unknown flag throws rather than being skipped — the argv has exactly
 * one author, so a token this parse does not know is a seam that has already
 * come apart, and reporting on a cadence the chain never declared would be
 * the quiet version of that.
 */
export function parseBudgetArgs(argv: string[]): BudgetDeclaration {
  const budget: BudgetDeclaration = {};
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (value === undefined) {
      throw new Error(`budget hook: ${flag} was passed no value`);
    }
    switch (flag) {
      case CONTEXT_WINDOW_FLAG:
        budget.contextWindow = Number(value);
        break;
      case EVERY_CALLS_FLAG:
        budget.everyCalls = Number(value);
        break;
      case THRESHOLDS_FLAG:
        budget.thresholds = value.split(",").map(Number);
        break;
      default:
        throw new Error(`budget hook: unknown argument ${flag}`);
    }
  }
  return validateBudget(budget);
}

/**
 * The command the provider runs after a tool call: this node, this module,
 * and the chain's declaration on the argv.
 *
 * The interpreter is spelled out rather than inherited from
 * `process.execArgv`, and the TypeScript loader is resolved here rather than
 * named as a bare specifier, because the hook runs in whatever directory the
 * provider gives it: `--import tsx` resolves against the child's cwd, so a
 * worktree without the package installed under it would fail the hook on
 * every tool call. Resolved from this module, the loader is the one the
 * running flume already loaded.
 *
 * A checkout runs this module as TypeScript and a published build runs the
 * emitted JavaScript beside it; the extension is what decides, because it is
 * what node can and cannot execute on its own.
 *
 * Resolved through `createRequire` rather than the loader's own
 * `import.meta` resolver, which the suite's transform does not supply; the
 * package exports one entry for both conditions, so the two answer the same
 * file. The answer is handed over as a URL because an absolute win32 path on
 * that flag reads as a specifier with a drive-letter scheme.
 */
export function budgetHookCommand(budget: BudgetDeclaration): string {
  validateBudget(budget);
  const loader = HOOK_MODULE_PATH.endsWith(".ts")
    ? [
        "--import",
        pathToFileURL(createRequire(import.meta.url).resolve("tsx")).href,
      ]
    : [];
  return [
    process.execPath,
    ...loader,
    HOOK_MODULE_PATH,
    ...budgetHookArgs(budget),
  ]
    .map(shellQuote)
    .join(" ");
}

/**
 * One argument as a shell reads it back. The provider runs a hook's command
 * through a shell, so a path carrying a space is two arguments unless it is
 * quoted, and `HOOK_MODULE_PATH` is a path this package never chose.
 *
 * Single quotes on posix and double quotes on win32 — the two shells differ
 * on which fence suspends interpretation, and win32 paths cannot carry the
 * quote character the double fence would need escaping for.
 */
function shellQuote(arg: string): string {
  if (/^[A-Za-z0-9_.,:=/@+-]+$/.test(arg)) return arg;
  return process.platform === "win32"
    ? `"${arg}"`
    : `'${arg.replaceAll("'", `'\\''`)}'`;
}

/**
 * Whether this tool call is one the chain asked to be told about: the
 * cadence beat, or a turn that carried the context past a declared
 * threshold.
 *
 * A crossing is taken here, in tokens, against the window the reading names
 * — the fraction is computed where it is compared rather than read off a
 * copy stored beside the tokens it was taken over
 * (`.claude/rules/engineering.md`, *Derived state is computed, never
 * restated beside its source*).
 *
 * It is read against the turn before, so a threshold reports once and not on
 * every call after it. An absent prior context reads as below every
 * threshold, which re-reports a crossing rather than swallowing one.
 */
export function budgetLineDue(
  reading: BudgetReading,
  budget: BudgetDeclaration,
): boolean {
  const everyCalls = budget.everyCalls ?? 1;
  if (reading.toolCalls > 0 && reading.toolCalls % everyCalls === 0) return true;
  // A windowless reading is a windowless declaration, which `validateBudget`
  // has already refused thresholds to: the cadence above was its only arm,
  // and there is nothing here to take a fraction of.
  const { contextWindow } = reading;
  if (contextWindow === undefined) return false;
  const prior = reading.priorContextTokens ?? 0;
  return (budget.thresholds ?? []).some((threshold) => {
    const crossing = threshold * contextWindow;
    return reading.contextTokens >= crossing && prior < crossing;
  });
}

/** What the hook writes, on each stream, for one tool call. */
export interface BudgetHookOutcome {
  /** The provider's hook-output JSON carrying the line, or nothing. */
  stdout: string;
  /** Why no line was composed, where the transcript held none. */
  stderr: string;
}

/**
 * One tool call answered: the declaration off `argv`, the transcript off the
 * provider's hook input, and the line — or the reason there is none — back.
 *
 * The transcript path is taken from the input verbatim, never rebuilt from a
 * session id and a directory layout: the provider states it, so the hook
 * reads the statement (`.claude/rules/engine-boundary.md`, *Told, not
 * inferred*). Input that names no transcript throws, because a hook that
 * quietly reported nothing would be indistinguishable from an agent with
 * room to spare.
 */
export async function budgetHookOutcome(
  argv: string[],
  hookInput: string,
): Promise<BudgetHookOutcome> {
  const budget = parseBudgetArgs(argv);
  const parsed: unknown = JSON.parse(hookInput);
  const transcriptPath =
    parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>).transcript_path
      : undefined;
  if (typeof transcriptPath !== "string" || transcriptPath === "") {
    throw new Error(
      "budget hook: the provider's hook input names no transcript_path to read",
    );
  }
  const read = await readBudgetLine(transcriptPath, {
    ...(budget.contextWindow !== undefined
      ? { contextWindow: budget.contextWindow }
      : {}),
  });
  if (read.kind === "none") return { stdout: "", stderr: `budget: ${read.reason}\n` };
  if (!budgetLineDue(read.reading, budget)) return { stdout: "", stderr: "" };
  return { stdout: `${JSON.stringify(additionalContext(read.line))}\n`, stderr: "" };
}

/**
 * The line in the shape {@link HOOK_EVENT_NAME} hands text to the agent's
 * next turn. Provider shape, spelled at the one site that writes it.
 */
function additionalContext(line: string): unknown {
  return {
    hookSpecificOutput: {
      hookEventName: HOOK_EVENT_NAME,
      additionalContext: line,
    },
  };
}

/** Everything on a readable stream, as one string. */
async function readAll(stream: NodeJS.ReadStream): Promise<string> {
  stream.setEncoding("utf8");
  let text = "";
  for await (const chunk of stream) text += chunk as string;
  return text;
}

/**
 * Run only when the provider invoked this module as its hook, never when the
 * adapter imported it for {@link budgetHookCommand}.
 *
 * A plain comparison, where `isInvokedDirectly` (`src/cli.ts`) folds both
 * sides through the filesystem first: that check answers a path an operator
 * or a package manager spelled, which a junction install moves out of the
 * module's own alphabet. This one answers `HOOK_MODULE_PATH`, because the
 * command that invoked it was rendered from `HOOK_MODULE_PATH` — the two
 * sides are one expression, and folding them would only hide a day when they
 * stop being.
 */
if (process.argv[1] === HOOK_MODULE_PATH) {
  readAll(process.stdin)
    .then((input) => budgetHookOutcome(process.argv.slice(2), input))
    .then(({ stdout, stderr }) => {
      if (stdout) process.stdout.write(stdout);
      if (stderr) process.stderr.write(stderr);
    })
    .catch((err: unknown) => {
      process.stderr.write(`${(err as Error).message}\n`);
      process.exitCode = 1;
    });
}
