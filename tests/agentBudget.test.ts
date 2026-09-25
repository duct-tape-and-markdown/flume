/**
 * The adapter's side of the budget hook: what `claudeCode({ budget })` puts
 * on the argv, and what an undeclared budget leaves alone
 * (`spec/chain.md`, *The agent seam*).
 *
 * Its own file rather than a case in `tests/Agent.test.ts`, because both
 * cases here carry a named line of the entry that shipped the option: the
 * judge lays a line's file over the base tree, so a file importing the
 * modules that entry introduced would red at the base for the import rather
 * than for the behavior. Nothing here reaches past the adapter.
 */

import { beforeEach, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";

vi.mock("node:child_process", () => ({
  spawn: vi.fn(),
  execFile: vi.fn(),
}));

import { spawn } from "node:child_process";

import { claudeCode, type ClaudeCodeOptions } from "../src/Agent.ts";

const spawnMock = vi.mocked(spawn);

interface FakeStream extends EventEmitter {
  setEncoding: (encoding: string) => void;
}

/** The argv one `claudeCode(opts)` invocation hands the spawn. */
async function argvOf(opts: ClaudeCodeOptions): Promise<string[]> {
  const proc = new EventEmitter() as EventEmitter & {
    stdout: FakeStream;
    stderr: FakeStream;
    stdin: { write: () => void; end: () => void; on: () => void };
    pid: number;
    exitCode: number | null;
    signalCode: NodeJS.Signals | null;
  };
  const stream = (): FakeStream => {
    const s = new EventEmitter() as FakeStream;
    s.setEncoding = (): void => {};
    return s;
  };
  proc.pid = 4242;
  proc.exitCode = null;
  proc.signalCode = null;
  proc.stdout = stream();
  proc.stderr = stream();
  proc.stdin = { write: (): void => {}, end: (): void => {}, on: (): void => {} };
  spawnMock.mockReturnValueOnce(proc as never);

  const settled = claudeCode(opts).invoke({ cwd: "/tmp", prompt: "p" });
  proc.emit("close", 0);
  await settled;

  expect(spawnMock).toHaveBeenCalledOnce();
  return spawnMock.mock.calls[0]![1] as string[];
}

beforeEach(() => {
  spawnMock.mockReset();
});

it("a declared budget puts the adapter's hook on that invocation's own settings and never on the user's", async () => {
  const args = await argvOf({
    outputFormat: "stream-json",
    budget: { contextWindow: 200_000, everyCalls: 5, thresholds: [0.7, 0.8] },
  });

  const flag = args.indexOf("--settings");
  expect(flag).toBeGreaterThanOrEqual(0);
  const settings = args[flag + 1];
  expect(settings).toBeDefined();

  // Inline JSON, not a path: the registration has no on-disk home, so there
  // is no settings file for it to reach the user's own through, and no
  // residue for a second invocation to inherit. `JSON.parse` over a path
  // would throw, which is the check — the leading brace only says so first.
  expect(settings!.startsWith("{")).toBe(true);
  // The event key is spelled by hand here and in the two reads below —
  // declared divergence from `.claude/rules/engineering.md`, *Derived state is
  // computed, never restated beside its source*, over `HOOK_EVENT_NAME`
  // (`src/budgetHook.ts`), which is the key `budgetSettings` (`src/Agent.ts`)
  // writes. The name is the provider's, not ours, so a hand spelling is the
  // only thing holding the key this adapter registers under in agreement with
  // the event the provider fires. Keying this reader off the constant would
  // read the writer's own value back — the constant compared to itself, a
  // provider rename green on both sides, the self-agreement
  // `.claude/rules/engineering.md`, *A seam gate reads what the real writer
  // wrote* names.
  const parsed = JSON.parse(settings!) as {
    hooks: {
      PostToolUse: { matcher: string; hooks: { type: string; command: string }[] }[];
    };
  };

  // Both reads spell it by hand for the reason above: the literal, not the
  // constant, is what proves the adapter registered under the provider's
  // event.
  const registered = parsed.hooks.PostToolUse.flatMap((m) => m.hooks);
  expect(registered.length).toBeGreaterThan(0);
  expect(parsed.hooks.PostToolUse[0]!.matcher).toBe("*");
  const [hook] = registered;
  expect(hook!.type).toBe("command");
  // The adapter's own script, run with the declaration the chain made.
  expect(hook!.command).toContain("budgetHook");
  expect(hook!.command).toContain("--context-window 200000");
  expect(hook!.command).toContain("--every-calls 5");
  expect(hook!.command).toContain("--thresholds 0.7,0.8");
});

it("an undeclared budget registers no hook and leaves the adapter's argv unchanged", async () => {
  const args = await argvOf({ outputFormat: "stream-json" });

  expect(args).toEqual([
    "-p",
    "--output-format",
    "stream-json",
    "--verbose",
    "--dangerously-skip-permissions",
    "--strict-mcp-config",
  ]);
  expect(args).not.toContain("--settings");
});
