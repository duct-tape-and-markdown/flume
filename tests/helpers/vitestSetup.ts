/**
 * The `setupFiles` entry both vitest lanes load before collecting a suite
 * (`vitest.config.ts`). Its whole job is to arm the state-root leak guard for
 * every suite file, including the ones that never spawn a CLI — a guard
 * installed only where it was remembered watches every file except the one
 * that leaks.
 *
 * Not *.test.ts, so neither lane collects it as a suite of its own.
 */

import { installStateRootLeakGuard } from "./subprocess.ts";

/** The bays this run refuses to see appear — read back by the wiring pin. */
export const ARMED_STATE_ROOT_WATCH = installStateRootLeakGuard();
