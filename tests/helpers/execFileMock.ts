/**
 * The shape a mocked `execFile` has to have for the engine's spawn doors to
 * run over it.
 *
 * Node's promisified `execFile` hands its caller two things: a promise of
 * `{ stdout, stderr }`, and the child beside it on `.child`. Both are
 * load-bearing here — the engine's doors read that child to end its stdin as
 * the spawn hands it over (`endChildStdin`, `src/spawnShim.ts`), because
 * `execFile` composes its own spawn options and forwards no `stdio`. A mock
 * resolving a bare stdout string makes every caller's destructuring read
 * `undefined`; a mock with no child throws where the door ends the pipe.
 * Either way the suite reads a mock's own fiction as the engine's bug
 * (`.claude/rules/engineering.md`, *A seam gate reads what the real writer
 * wrote* is the same instinct one layer down).
 *
 * Three suites mock that call — the door's own (`tests/spawnShim.test.ts`),
 * the worktree provisioner's (`tests/setupWorktree.test.ts`) and git's
 * (`tests/git.test.ts`) — so the shape is declared once, here
 * (`.claude/rules/engineering.md`, *A module is one job*).
 *
 * Each caller still installs its own `vi.mock("node:child_process")`: the
 * mock registry is per test module, and nothing here can reach it.
 *
 * Not *.test.ts, so neither vitest lane collects it as a suite of its own.
 */

import type { ChildProcess, PromiseWithChild } from "node:child_process";
import { promisify } from "node:util";

/** What a mocked spawn's callback answers with. */
type ExecFileCallback = (
  err: Error | null,
  stdout: string,
  stderr: string,
) => void;

/**
 * `settled` with a child attached, and `onStdinEnd` called when that child's
 * stdin is ended.
 *
 * The child is shaped exactly as far as a capturing spawn's caller can reach
 * it: the promise resolves the whole output at once, so nothing writes to
 * that stream and ending it is the entire surface. A fake carrying more would
 * be inventing a seam the real promise does not offer.
 */
export function spawnedPromise<T>(
  settled: Promise<T>,
  onStdinEnd: () => void = (): void => {},
): PromiseWithChild<T> {
  const spawned = settled as PromiseWithChild<T>;
  spawned.child = { stdin: { end: onStdinEnd } } as unknown as ChildProcess;
  return spawned;
}

/**
 * Give `mock` the `promisify.custom` the real `execFile` carries: the
 * `{ stdout, stderr }` resolution read off the mock's own callback — so what
 * a spawn answers stays the case's to program — and the child the door ends.
 *
 * `onStdinEnd` is handed the command of the attempt whose stdin was ended,
 * for a case whose subject is that ending. Omitted, the end is a no-op the
 * door can make without the mock noticing.
 */
export function definePromisifiedExecFile(
  mock: (...args: unknown[]) => unknown,
  onStdinEnd?: (command: string) => void,
): void {
  Object.defineProperty(mock, promisify.custom, {
    configurable: true,
    value: (command: string, args: readonly string[], opts: unknown) =>
      spawnedPromise(
        new Promise((resolve, reject) => {
          mock(command, args, opts, ((err, stdout, stderr) =>
            err ? reject(err) : resolve({ stdout, stderr })) as ExecFileCallback);
        }),
        () => onStdinEnd?.(command),
      ),
  });
}
