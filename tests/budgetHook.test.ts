/**
 * `src/budgetHook.ts`'s own cover — the script the adapter registers, and
 * the argv vocabulary the two halves of that registration share
 * (`spec/chain.md`, *The agent seam*).
 *
 * The seam case runs the real command: `budgetHookCommand` renders it and a
 * shell starts it, so the declaration a chain made is decoded by the script
 * that was actually invoked rather than by a second reader this file drove
 * by hand (`.claude/rules/engineering.md`, *A seam gate reads what the real
 * writer wrote*). The transcript under it is hand-authored for the same
 * reason `tests/budgetLine.test.ts` gives: no writer this suite can run
 * produces one.
 */

import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, expect, it } from "vitest";

import {
  budgetHookArgs,
  budgetHookCommand,
  budgetLineDue,
  budgetHookOutcome,
  parseBudgetArgs,
  validateBudget,
  type BudgetDeclaration,
  type BudgetHookOutcome,
} from "../src/budgetHook.ts";
import type { BudgetReading } from "../src/budgetLine.ts";
import { mkTempDir } from "./helpers/fixtureRoot.ts";
import { exec, SPAWN_BUDGET_MS } from "./helpers/subprocess.ts";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((d) => rm(d, { recursive: true, force: true })),
  );
});

const START = "2026-09-24T18:00:00.000Z";
const at = (minutes: number): string =>
  new Date(Date.parse(START) + minutes * 60_000).toISOString();

const assistantTurn = (
  timestamp: string,
  toolCalls: number,
  contextTokens: number,
): unknown => ({
  type: "assistant",
  timestamp,
  message: {
    role: "assistant",
    content: Array.from({ length: toolCalls }, (_, i) => ({
      type: "tool_use",
      id: `t${i}`,
      name: "Bash",
      input: {},
    })),
    usage: {
      input_tokens: contextTokens,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
      output_tokens: 11,
    },
  },
});

/** A transcript on disk, since a path is what the provider hands the hook. */
async function transcriptAt(...events: unknown[]): Promise<string> {
  const dir = await mkTempDir("flume-budget-hook-");
  roots.push(dir);
  const path = join(dir, "session.jsonl");
  await writeFile(path, `${events.map((e) => JSON.stringify(e)).join("\n")}\n`, "utf8");
  return path;
}

/**
 * The input the provider writes on the hook's stdin.
 *
 * `hook_event_name` is hand-spelled rather than read off `HOOK_EVENT_NAME`
 * (`src/budgetHook.ts`) — declared divergence from
 * `.claude/rules/engineering.md`, *Derived state is computed, never restated
 * beside its source*. The event name is not this suite's value to derive: it
 * is the provider's, and a hand spelling is the only thing holding the two
 * production sites that key on it — the settings key `budgetSettings`
 * (`src/Agent.ts`) arms the hook under, and the `hookEventName` the hook
 * echoes to claim its output — in agreement with the provider. Reading it
 * off the constant would compare the constant to itself and leave a provider
 * rename green on both sides, the self-agreement
 * `.claude/rules/engineering.md`, *A seam gate reads what the real writer
 * wrote* names.
 */
const hookInput = (transcriptPath: string): string =>
  JSON.stringify({
    session_id: "s1",
    transcript_path: transcriptPath,
    hook_event_name: "PostToolUse",
    tool_name: "Bash",
  });

const reading = (over: Partial<BudgetReading>): BudgetReading => ({
  contextTokens: 1_000,
  toolCalls: 1,
  elapsedMs: 1_000,
  ...over,
});

it("the rendered hook command decodes back to the declaration the chain made, through the script it starts", async () => {
  const path = await transcriptAt(
    assistantTurn(at(0), 1, 10_000),
    assistantTurn(at(2), 1, 150_000),
  );
  const budget: BudgetDeclaration = {
    contextWindow: 200_000,
    everyCalls: 2,
    thresholds: [0.7],
  };
  const run = exec(budgetHookCommand(budget), [], {
    shell: true,
    timeout: SPAWN_BUDGET_MS,
  });
  run.child.stdin!.end(hookInput(path));
  const { stdout } = await run;

  const emitted = JSON.parse(stdout) as {
    hookSpecificOutput: { hookEventName: string; additionalContext: string };
  };
  // Hand-spelled for the reason `hookInput` above states: this literal is the
  // only thing holding the echoed `hookEventName` in agreement with the
  // provider, and reading it off `HOOK_EVENT_NAME` (`src/budgetHook.ts`) —
  // which is what the hook echoes — would compare the constant to itself.
  expect(emitted.hookSpecificOutput.hookEventName).toBe("PostToolUse");
  const line = emitted.hookSpecificOutput.additionalContext;
  // Every declared field reached the script: the window as the denominator,
  // the cadence as the beat that let this second call through, the tool
  // count and the clock off the transcript itself.
  expect(line).toContain("150,000/200,000 tokens (75%)");
  expect(line).toContain("2 tool calls");
  expect(line).toContain("elapsed ");
}, SPAWN_BUDGET_MS);

it("the hook's argv round-trips a declaration through the flags the adapter writes", () => {
  const budget: BudgetDeclaration = {
    contextWindow: 123_456,
    everyCalls: 7,
    thresholds: [0.5, 0.9],
  };
  const args = budgetHookArgs(budget);
  expect(args.length).toBeGreaterThan(0);
  expect(parseBudgetArgs(args)).toEqual(budget);
  expect(parseBudgetArgs(budgetHookArgs({}))).toEqual({});
});

it("the hook refuses an argument the adapter never writes rather than reporting on a cadence nobody declared", () => {
  expect(() => parseBudgetArgs(["--budget", "9"])).toThrow(/unknown argument/);
  expect(() => parseBudgetArgs(["--every-calls"])).toThrow(/no value/);
});

it("a budget declaration that cannot be read on refuses where the chain declared it", () => {
  expect(() => validateBudget({ contextWindow: 0 })).toThrow(/contextWindow/);
  expect(() => validateBudget({ everyCalls: 2.5 })).toThrow(/whole number/);
  expect(() => validateBudget({ thresholds: [1.5] })).toThrow(/fraction/);
  expect(validateBudget({ contextWindow: 1, everyCalls: 1, thresholds: [1] })).toEqual({
    contextWindow: 1,
    everyCalls: 1,
    thresholds: [1],
  });
});

it("a budget declaring thresholds and no context window refuses where the chain declared it", () => {
  // Every arm of the pair, since a threshold with no window reaches the hook
  // by two roads: the adapter's chain-build check, and the hook's own parse
  // of the argv that check let through.
  expect(() => validateBudget({ thresholds: [0.7] })).toThrow(/contextWindow/);
  expect(() => validateBudget({ everyCalls: 5, thresholds: [0.7, 0.8] })).toThrow(
    /contextWindow/,
  );
  expect(() => budgetHookCommand({ thresholds: [0.7] })).toThrow(/contextWindow/);
  expect(() => parseBudgetArgs(["--thresholds", "0.7"])).toThrow(/contextWindow/);
  // The window is what makes them readable on, and an empty list declares no
  // arm at all — neither is refused.
  expect(validateBudget({ contextWindow: 200_000, thresholds: [0.7] })).toEqual({
    contextWindow: 200_000,
    thresholds: [0.7],
  });
  expect(validateBudget({ thresholds: [] })).toEqual({ thresholds: [] });
});

it("the cadence beats on every Nth call, and undeclared it beats on each one", () => {
  const every3: BudgetDeclaration = { everyCalls: 3 };
  const beats = [1, 2, 3, 4, 5, 6].map((toolCalls) =>
    budgetLineDue(reading({ toolCalls }), every3),
  );
  expect(beats).toEqual([false, false, true, false, false, true]);
  expect(budgetLineDue(reading({ toolCalls: 1 }), {})).toBe(true);
  // A transcript that has yet to record a call is not a beat: zero is
  // divisible by every cadence, and a line over no calls states nothing.
  expect(budgetLineDue(reading({ toolCalls: 0 }), {})).toBe(false);
});

it("a threshold reports on the turn that crosses it and not on the calls after", () => {
  const CONTEXT_WINDOW = 200_000;
  const THRESHOLD = 0.8;
  const budget: BudgetDeclaration = {
    contextWindow: CONTEXT_WINDOW,
    everyCalls: 100,
    thresholds: [THRESHOLD],
  };
  // Tokens against the window the reading names, since that is the shape a
  // crossing is taken on: eighty percent of this window is 160,000.
  const windowed = (over: Partial<BudgetReading>): BudgetReading =>
    reading({ contextWindow: CONTEXT_WINDOW, ...over });
  const crossing = windowed({
    toolCalls: 3,
    contextTokens: 162_000,
    priorContextTokens: 158_000,
  });
  const after = windowed({
    toolCalls: 4,
    contextTokens: 170_000,
    priorContextTokens: 162_000,
  });
  const below = windowed({
    toolCalls: 5,
    contextTokens: 100_000,
    priorContextTokens: 80_000,
  });
  expect(THRESHOLD * CONTEXT_WINDOW).toBe(160_000);
  expect(budgetLineDue(crossing, budget)).toBe(true);
  expect(budgetLineDue(after, budget)).toBe(false);
  expect(budgetLineDue(below, budget)).toBe(false);
  // A turn that is the transcript's first names no prior context, which
  // reads as below every threshold: the crossing is re-reported rather than
  // swallowed, and at a cadence of 100 nothing else is carrying this call.
  expect(
    budgetLineDue(windowed({ toolCalls: 3, contextTokens: 162_000 }), budget),
  ).toBe(true);
});

it("a call the cadence and thresholds both pass over writes nothing at all", async () => {
  const path = await transcriptAt(assistantTurn(at(0), 1, 10_000));
  const outcome: BudgetHookOutcome = await budgetHookOutcome(
    budgetHookArgs({ contextWindow: 200_000, everyCalls: 50, thresholds: [0.9] }),
    hookInput(path),
  );
  expect(outcome).toEqual({ stdout: "", stderr: "" });
});

it("a transcript the hook can read but compose no line from says why on stderr", async () => {
  const path = await transcriptAt({ type: "user", timestamp: at(0) });
  const outcome = await budgetHookOutcome(budgetHookArgs({}), hookInput(path));
  expect(outcome.stdout).toBe("");
  expect(outcome.stderr).toContain("no assistant event");
});

it("hook input naming no transcript refuses rather than reporting an agent with room to spare", async () => {
  await expect(
    budgetHookOutcome(budgetHookArgs({}), JSON.stringify({ session_id: "s1" })),
  ).rejects.toThrow(/transcript_path/);
});
