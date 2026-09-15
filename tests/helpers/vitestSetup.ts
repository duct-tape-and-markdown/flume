/**
 * The `setupFiles` entry both vitest lanes load before collecting a suite
 * (`vitest.config.ts`). Its job is to arm, for every suite file, the two
 * protections no single suite can install for itself: the state-root leak
 * guard — a guard installed only where it was remembered watches every file
 * except the one that leaks — and the auto-gc pin every fixture repository
 * runs under.
 *
 * Not *.test.ts, so neither lane collects it as a suite of its own.
 */

import { installStateRootLeakGuard, pinGitAutoGcOff } from "./subprocess.ts";

/** The bays this run refuses to see appear — read back by the wiring pin. */
export const ARMED_STATE_ROOT_WATCH = installStateRootLeakGuard();

/**
 * Arm the auto-gc pin on the worker's own environment, before any suite runs
 * a git child.
 *
 * On `process.env` rather than on the helper's spawn wrappers, because the
 * fixtures do not all spawn through one: ~25 sites call `execFile("git", …,
 * { cwd })` with no `env` and inherit this process's, `hermeticEnv()` copies
 * it, and a spawned `flume` passes it down to its own git. One mutation here
 * covers every one of them, so no creation site has to remember the pin.
 */
export const ARMED_GIT_AUTO_GC_OFF = pinGitAutoGcOff(process.env);
