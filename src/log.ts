/**
 * The logging seam — the interface the engine narrates through and the
 * console implementation it falls back to.
 *
 * Its own file because it is its own job: `Logger` is the one type every
 * surface that narrates takes (`src/Dispatcher.ts`, `src/worktrees.ts`,
 * `src/priorAttempts.ts`, `src/friction.ts`, `src/loopSupervisor.ts`), and
 * homing it in the module that happens to hold the dispatcher made three of
 * those import a type back out of the module that imports them
 * (`.claude/rules/engineering.md`, *A module is one job*).
 */

/**
 * Three-level logging seam. The dispatcher writes harness narration through
 * these methods; consumers can route them to a structured logger or simply
 * pass `consoleLogger` (the default).
 */
export interface Logger {
  info(line: string): void;
  warn(line: string): void;
  error(line: string): void;
}

/**
 * Default `Logger` implementation: `info` → `console.log`, `warn` →
 * `console.warn`, `error` → `console.error`. Used by the dispatcher when
 * `DispatcherOptions.log` is omitted.
 */
export const consoleLogger: Logger = {
  info: (l) => console.log(l),
  warn: (l) => console.warn(l),
  error: (l) => console.error(l),
};
