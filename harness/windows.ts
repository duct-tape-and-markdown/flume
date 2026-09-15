/**
 * The plan slices' windows, assembled (`spec/harness.md`, *The phases*) — for
 * the slices a consumer enabled, in the order the ladder consults them, each
 * slice's own window taken from the module its name is.
 *
 * **One derivation per window, two readers.** The ladder asks "is this slice
 * live"; the slice's prompt asks "what is in it". Both answers come from one
 * window object, so a slice cannot be woken over a window its prompt then
 * renders as empty, nor render material the ladder never counted
 * (`.claude/rules/engineering.md`, *Derived state is computed, never
 * restated beside its source*).
 *
 * This module is the assembly and nothing else. What a window is handed and
 * hands back is `sliceWindow.ts`; the tree reads every window is drawn from
 * are `gitRange.ts`; each slice's own window is `inboxWindow.ts`,
 * `deriveWindow.ts` and `sweepWindow.ts`. Which slices a consumer enabled,
 * what order the ladder consults them in, and how a window's arg reaches a
 * prompt belong to the declaration, `handoff.ts` and the chain factory that
 * reads this.
 */

import { INBOX_PHASE, PLAN_SLICES, type PlanSlice } from "./declaration.js";
import { deriveWindow } from "./deriveWindow.js";
import { inboxWindow } from "./inboxWindow.js";
import type {
  PlanSliceWindow,
  PlanSliceWindowsOptions,
} from "./sliceWindow.js";
import { sweepWindow } from "./sweepWindow.js";

/**
 * The windows for the plan slices this declaration enables, in the order
 * {@link PLAN_SLICES} lists them — which is the order the ladder consults.
 *
 * A slice the declaration did not enable is absent rather than present and
 * permanently closed: the ladder's `exclude` leg and the default handoff's
 * refusal leg both read the list they are given, and a slice that is always
 * dead reads as a phase the chain carries but never runs.
 */
export function planSliceWindows(
  options: PlanSliceWindowsOptions,
): PlanSliceWindow[] {
  const enabled = new Set<PlanSlice>(options.declaration.slices.enabled);
  return PLAN_SLICES.filter((name) => enabled.has(name)).map((name) =>
    window(name, options),
  );
}

/** One slice's window, by name. */
function window(
  name: PlanSlice,
  options: PlanSliceWindowsOptions,
): PlanSliceWindow {
  switch (name) {
    case INBOX_PHASE:
      return inboxWindow(options);
    case "plan-derive":
      return deriveWindow(options);
    case "plan-sweep":
      return sweepWindow(options);
  }
}
