/**
 * The spawned child every provider case drives, and the host it drives it on.
 *
 * `src/claudeCode.ts` streams its child's stdio and signals its process
 * group, so a case over it needs a `spawn` return value with the three
 * fields `signalProcessTree` (`src/processTree.ts`) reads and the three
 * streams the provider wires. One declaration of that fake, because the
 * provider's own file and the shared-alphabet agreement gates
 * (`tests/streamJson.test.ts`) both drive it and a second spelling is a
 * second thing to keep in step (`.claude/rules/engineering.md`, *A module is
 * one job*).
 *
 * Each caller still installs its own `vi.mock("node:child_process")`: the
 * mock registry is per test module, and nothing here can reach it.
 *
 * Not *.test.ts, so neither vitest lane collects it as a suite of its own.
 */

import { EventEmitter } from "node:events";

export interface FakeChildStream extends EventEmitter {
  setEncoding: (encoding: string) => void;
}
export interface FakeChildStdin extends EventEmitter {
  write: (chunk: string) => void;
  end: () => void;
  written: string[];
}
export interface FakeChildProcess extends EventEmitter {
  stdout: FakeChildStream;
  stderr: FakeChildStream;
  stdin: FakeChildStdin;
  pid: number;
  exitCode: number | null;
  signalCode: NodeJS.Signals | null;
}

/**
 * The pid every fake child reports, and so the group `terminateProcessTree`
 * (`src/processTree.ts`) signals as `-FAKE_PID`. A constant rather than a
 * per-case value: the cases assert the *target*, and one spelling of it
 * keeps that assertion about the sign rather than about the number.
 */
export const FAKE_PID = 4242;

export function fakeChildProcess(): FakeChildProcess {
  const proc = new EventEmitter() as FakeChildProcess;
  // The three fields `signalProcessTree` (`src/processTree.ts`) reads before
  // it signals, declared together: the null pair is what makes this fake a
  // live child rather than a reaped one, whose pid the engine declines
  // (`.claude/rules/platform-facts.md`, *A reaped pid returns to the host's
  // allocation pool*).
  proc.pid = FAKE_PID;
  proc.exitCode = null;
  proc.signalCode = null;
  const stdout = new EventEmitter() as FakeChildStream;
  stdout.setEncoding = (): void => {};
  const stderr = new EventEmitter() as FakeChildStream;
  stderr.setEncoding = (): void => {};
  const stdin = new EventEmitter() as FakeChildStdin;
  stdin.written = [];
  stdin.write = (chunk: string): void => {
    stdin.written.push(chunk);
  };
  stdin.end = (): void => {};
  proc.stdout = stdout;
  proc.stderr = stderr;
  proc.stdin = stdin;
  return proc;
}

/** Run `fn` with `process.platform` reading as `platform`, restored after. */
export async function withPlatform(
  platform: NodeJS.Platform,
  fn: () => Promise<void>,
): Promise<void> {
  const original = Object.getOwnPropertyDescriptor(process, "platform")!;
  Object.defineProperty(process, "platform", { value: platform });
  try {
    await fn();
  } finally {
    Object.defineProperty(process, "platform", original);
  }
}
