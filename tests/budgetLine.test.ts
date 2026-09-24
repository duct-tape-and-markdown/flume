/**
 * `src/budgetLine.ts`'s own cover — the transcript read behind the line the
 * adapter's hook hands a mid-session agent.
 *
 * The fixtures are hand-authored, and the shape they spell is not invented:
 * the event types, the nesting of an assistant turn's content blocks and
 * usage, the token field names and the per-event timestamp are the ones a
 * live session transcript carries, read off a capture on 2026-09-24 — the
 * same capture `.claude/rules/platform-facts.md`, *stream-json assistant
 * events carry per-message usage* was measured on. No writer this suite can
 * run produces a transcript, so the alternative is not a real one; what the
 * fixtures must not do is drift, which is why they are built from the field
 * names the reader keys on rather than from a snapshot of one session.
 *
 * Every case reads through a path on disk, because a path is what the
 * provider hands the hook.
 */

import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, expect, it } from "vitest";

import {
  readBudgetLine,
  type BudgetLineOptions,
  type BudgetLineRead,
  type BudgetReading,
} from "../src/budgetLine.ts";
import { mkTempDir } from "./helpers/fixtureRoot.ts";

const roots: string[] = [];

const transcriptAt = async (body: string): Promise<string> => {
  const dir = await mkTempDir("flume-budget-line-");
  roots.push(dir);
  const path = join(dir, "session.jsonl");
  await writeFile(path, body, "utf8");
  return path;
};

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((d) => rm(d, { recursive: true, force: true })),
  );
});

const jsonl = (...events: unknown[]): string =>
  `${events.map((e) => JSON.stringify(e)).join("\n")}\n`;

const userTurn = (timestamp: string, text: string): unknown => ({
  type: "user",
  timestamp,
  message: { role: "user", content: text },
});

const assistantTurn = (
  timestamp: string,
  content: unknown[],
  usage?: Record<string, number>,
): unknown => ({
  type: "assistant",
  timestamp,
  message: {
    role: "assistant",
    content,
    ...(usage !== undefined ? { usage } : {}),
  },
});

const toolUse = (id: string, name: string): unknown => ({
  type: "tool_use",
  id,
  name,
  input: {},
});

const textBlock = (text: string): unknown => ({ type: "text", text });

/** The `"line"` arm, or a failure naming the reason there was none. */
const lineOf = (
  read: BudgetLineRead,
): { line: string; reading: BudgetReading } => {
  if (read.kind !== "line") {
    throw new Error(`expected a budget line, got none: ${read.reason}`);
  }
  return read;
};

/** The `"none"` arm, or a failure quoting the line that was composed. */
const noneOf = (read: BudgetLineRead): string => {
  if (read.kind !== "none") {
    throw new Error(`expected no budget line, got one: ${read.line}`);
  }
  return read.reason;
};

const START = "2026-09-24T18:00:00.000Z";
const at = (minutes: number): string =>
  new Date(Date.parse(START) + minutes * 60_000).toISOString();

it("the budget line reports context used against the declared window from the latest assistant message's input, cache-read and cache-creation tokens", async () => {
  const earlier = {
    input_tokens: 3,
    cache_read_input_tokens: 1_000,
    cache_creation_input_tokens: 500,
    output_tokens: 40,
  };
  const latest = {
    input_tokens: 7,
    cache_read_input_tokens: 40_000,
    cache_creation_input_tokens: 2_000,
    output_tokens: 9_999,
  };
  const context = (u: typeof latest): number =>
    u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens;

  // Vacuity: two turns carry usage, each of the three context fields is
  // non-zero in both, and the two turns' contexts differ — so "the latest"
  // and "all three fields" are each load-bearing on the number below, and
  // output tokens are excluded by the total rather than by luck.
  expect(context(latest)).not.toBe(context(earlier));
  expect(context(latest)).toBe(42_007);
  expect(latest.output_tokens).toBeGreaterThan(0);

  const path = await transcriptAt(
    jsonl(
      userTurn(START, "go"),
      assistantTurn(START, [textBlock("first")], earlier),
      userTurn(at(4), "carry on"),
      assistantTurn(
        at(5),
        [textBlock("second"), toolUse("toolu_1", "Bash")],
        latest,
      ),
    ),
  );

  const read = lineOf(
    await readBudgetLine(path, {
      contextWindow: 200_000,
      now: Date.parse(at(20)),
    }),
  );

  expect(read.reading.contextTokens).toBe(context(latest));
  // The window the reading was taken against, and the turn before's context
  // over that same window — the two facts a crossing is computed from, in
  // place of a fraction stored beside them.
  expect(read.reading.contextWindow).toBe(200_000);
  expect(read.reading.priorContextTokens).toBe(context(earlier));
  expect(read.line).toBe(
    "budget: context 42,007/200,000 tokens (21%) | elapsed 20m | 1 tool call",
  );

});

it("the budget line counts tool calls and elapsed clock from the transcript's own first message", async () => {
  const usage = {
    input_tokens: 5,
    cache_read_input_tokens: 900,
    cache_creation_input_tokens: 100,
    output_tokens: 20,
  };
  const firstCalls = [toolUse("toolu_1", "Read"), toolUse("toolu_2", "Grep")];
  const secondCalls = [toolUse("toolu_3", "Bash")];
  const now = Date.parse(at(14));

  // Vacuity: the calls are spread across two assistant turns, so a count
  // reading one turn cannot reach three; and the last event's own clock is a
  // minute from now, so a 14m answer can only have come from the first
  // message.
  expect(firstCalls.length + secondCalls.length).toBe(3);
  expect(firstCalls.length).toBeGreaterThan(0);
  expect(secondCalls.length).toBeGreaterThan(0);
  expect(now - Date.parse(at(13))).toBe(60_000);

  const path = await transcriptAt(
    jsonl(
      userTurn(START, "go"),
      assistantTurn(START, firstCalls, usage),
      userTurn(at(12), "results"),
      assistantTurn(at(13), secondCalls, usage),
    ),
  );

  // No window declared: elapsed and calls still arrive, and nothing is
  // reported against a window the chain never named.
  const read = lineOf(await readBudgetLine(path, { now }));

  expect(read.reading.toolCalls).toBe(3);
  expect(read.reading.elapsedMs).toBe(14 * 60_000);
  // No window on the reading, so nothing downstream can score a fraction
  // against one the chain never named.
  expect(read.reading.contextWindow).toBeUndefined();
  expect(read.line).toBe("budget: elapsed 14m | 3 tool calls");

});

it("a transcript whose latest assistant event carries no usage yields no budget line and says why", async () => {
  const usage = {
    input_tokens: 4,
    cache_read_input_tokens: 2_000,
    cache_creation_input_tokens: 600,
    output_tokens: 30,
  };
  const opened = jsonl(
    userTurn(START, "go"),
    assistantTurn(START, [textBlock("first")], usage),
  );
  const expired = `${opened}${jsonl(
    userTurn(at(2), "carry on"),
    assistantTurn(at(3), [toolUse("toolu_1", "Bash")]),
  )}`;

  // Held in a named variable, which is what the options type is exported to
  // be nameable for: the hook composing one reads the same shape.
  const opts: BudgetLineOptions = {
    contextWindow: 200_000,
    now: Date.parse(at(6)),
  };

  // Vacuity: the same transcript one event shorter does compose a line, so
  // the silence below is the missing usage on the latest event and not a
  // fixture nothing could read.
  const before = lineOf(await readBudgetLine(await transcriptAt(opened), opts));
  expect(before.reading.contextTokens).toBe(2_604);

  const reason = noneOf(
    await readBudgetLine(await transcriptAt(expired), opts),
  );
  expect(reason).toContain("latest assistant event carries no usage");

});

it("a transcript with no assistant event yields no budget line and says why", async () => {
  const path = await transcriptAt(jsonl(userTurn(START, "go")));

  const reason = noneOf(await readBudgetLine(path, { now: Date.parse(at(1)) }));
  expect(reason).toContain("no assistant event");

});

it("a transcript whose events carry no timestamp yields no budget line and says why", async () => {
  const usage = {
    input_tokens: 1,
    cache_read_input_tokens: 10,
    cache_creation_input_tokens: 5,
  };
  // Usage is present and the turn is readable — the clock is the only thing
  // missing, so this arm is reached rather than short-circuited above it.
  const path = await transcriptAt(
    jsonl({
      type: "assistant",
      message: { role: "assistant", content: [textBlock("hi")], usage },
    }),
  );

  const reason = noneOf(await readBudgetLine(path, { now: Date.parse(at(1)) }));
  expect(reason).toContain("no event in the transcript carries a timestamp");

});

it("a declared context window that is not a positive token count refuses rather than composing a percentage over it", async () => {
  const path = await transcriptAt(
    jsonl(
      userTurn(START, "go"),
      assistantTurn(START, [textBlock("hi")], {
        input_tokens: 1,
        cache_read_input_tokens: 10,
        cache_creation_input_tokens: 5,
      }),
    ),
  );

  await expect(readBudgetLine(path, { contextWindow: 0 })).rejects.toThrow(
    /positive number of tokens/,
  );

});
