/**
 * The `flume tick` process-boundary exit codes.
 *
 * Their own file because they are the one vocabulary two sides of a process
 * boundary share: `src/cli.ts` and `src/cliVerdict.ts` exit with them and
 * `src/loopSupervisor.ts` fail-fasts on them, so neither the writer's module
 * nor the reader's owns them (`.claude/rules/engineering.md`, *A module is
 * one job*).
 */

/**
 * `flume tick` exit code for an Axis-C terminal misconfiguration:
 * sysexits.h `EX_CONFIG`. Distinct from 0 (clean hibernate), 1 (other
 * harness errors), and {@link EX_MOUNT_DEAD} (the chain never resolved at
 * all) so the process boundary classifies the failure without reading logs.
 * `superviseLoop` fail-fasts on a child exiting with this code.
 */
export const EX_TERMINAL_MISCONFIG = 78;

/**
 * `flume tick` exit code for the mount-dead failure class: the
 * chain module cannot load, the state root is missing, or its declaration is
 * invalid — no agent ran, nothing here is retryable by waiting. Sibling to
 * {@link EX_TERMINAL_MISCONFIG}, not a variant of it: terminal misconfiguration
 * is a chain that *did* resolve but declares an inconsistent world
 * (orphaned awake flags); mount-dead is no resolved chain at all.
 * sysexits.h `EX_UNAVAILABLE`. `superviseLoop` fail-fasts on a child exiting
 * with this code exactly as it does on {@link EX_TERMINAL_MISCONFIG} — a
 * mount-dead chain is exactly as dead next tick as this one, so continuing
 * would only burn the remaining `--max` ticks re-hitting the same wall.
 */
export const EX_MOUNT_DEAD = 69;
