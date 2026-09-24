/**
 * The window a plan-state cursor opens: the commits past it, or the one
 * spelled reason there are none to read.
 *
 * The derive and sweep slices differ only in which cursor they are drawn past,
 * which globs they are drawn over, and what they make of the commits they get
 * — so the three states a cursor can be in are decided once here rather than
 * twice beside them (`.claude/rules/engineering.md`, *A module is one job*).
 *
 * **The cursors are fields, never prose.** `derivedThrough` and `sweptThrough`
 * arrive through {@link readCursor}, each off the file of the slice that owns
 * it; nothing here regexes a sha out of a narrative document
 * (`spec/harness.md`, *Plan state as declared state*). Which file that is
 * comes from the same place, so the repair a refusal names is the file the
 * value was missing from.
 *
 * **A range that cannot be read refuses, in the window itself.** A state root
 * with no artifact yet, a cursor naming no commit, or any git failure under
 * the render, each resolves to material the woken slice is handed rather than
 * to a throw or to an empty delta — an empty delta would advance a cursor over
 * commits nobody read (`.claude/rules/engineering.md`, *Loud or nothing*).
 *
 * What a slice does with the commits, and which glob list is its own, belong
 * to the slice windows that drive this.
 */

import { detailOf } from "./exec.js";
import {
  commitsPast,
  filesMatching,
  resolvesInTree,
  tipOf,
  type RangeCommit,
} from "./gitRange.js";
import { planStatePath } from "./layout.js";
import { cursorSlice, readCursor, type CursorField } from "./planState.js";
import type { WindowContext } from "./sliceWindow.js";

/**
 * The window a slice drawn past this cursor opens: the commits past it handed
 * to `render`, the bootstrap corpus where the slice that owns the cursor has
 * written no state file yet, or the refusal that stands in for either.
 *
 * The three states are decided here rather than beside each caller
 * (`.claude/rules/engineering.md`, *The fix lands at the mechanism*): a
 * cursor absent, a cursor naming no commit, a tree git will not read.
 *
 * `globs` is what the window looks at, and it is declared rather than assumed:
 * the bootstrap listing is drawn from it, and `render` narrows the same list
 * by the engine's own `matchesAny`. One dialect, so git is never handed a
 * second reading of the declaration.
 */
export function cursorWindow(
  field: CursorField,
  globs: string[],
  ctx: WindowContext,
  render: (cursor: string, commits: RangeCommit[]) => string,
): string {
  return bounded(field, ctx, () => {
    const cursor = readCursor(ctx.flumeDir, field);
    if (cursor === undefined) return bootstrap(field, ctx, globs);
    if (!resolvesInTree(ctx.cwd, cursor)) {
      return unresolvedCursor(field, cursor, ctx.flumeDir);
    }
    return render(cursor, commitsPast(ctx.cwd, cursor));
  });
}

/**
 * The window a slice with no state file yet opens over: everything the globs
 * name, read in full, ending on the tip the cursor is stamped at.
 *
 * Absence is the first tick's real state, not a degradation — a slice whose
 * own file was never written has no cursor, and the only honest window over
 * "nothing has been derived" is the whole corpus (`planState.ts`).
 *
 * **The tip is named here, not rediscovered by the tick.** A window that
 * said "stamp HEAD" would have the stamping tick resolve its own sha, so a
 * commit landing mid-tick would be stamped over unread
 * (`.claude/rules/posture-sweep.md`, *The stamp*). The tip is resolved
 * before the listing rather than after, so anything that lands while this
 * reads is at worst listed and not yet stamped — re-opened next tick, never
 * skipped.
 */
function bootstrap(
  field: CursorField,
  ctx: WindowContext,
  globs: string[],
): string {
  const tip = tipOf(ctx.cwd);
  return [
    `(bootstrap: no \`${field}\` yet — the whole of the declared paths is ` +
      `the window; read every file below)`,
    ...filesMatching(ctx.cwd, globs),
    "",
    `=== this window was drawn from tip ${tip}; the tick that closes it ` +
      `stamps \`${field}\` at exactly that sha ===`,
  ].join("\n");
}

/**
 * The file a refusal sends a tick to repair `field` in: the state file of the
 * slice that owns the cursor, never a plan state in general.
 *
 * Composed from the cursor's own owner rather than named per refusal, so a
 * cursor that moves to another slice's file moves both refusals with it
 * (`planState.ts`, {@link cursorSlice}).
 */
const stateFileFor = (field: CursorField, flumeDir: string): string =>
  planStatePath(flumeDir, cursorSlice(field));

/**
 * The window an unreadable range opens over: nothing, loudly.
 *
 * Rendered into the prompt rather than thrown out of it, and that is
 * deliberate. A throw here kills the tick before any agent runs — the engine
 * invokes `promptArgs` uncaught — so the tick ends with no verdict and the
 * next one is woken over the same unreadable tree with nothing said. The
 * refusal instead reaches the woken slice, naming what could not be read and
 * forbidding any cursor advance in the meantime
 * (`.claude/rules/engineering.md`, *Loud or nothing*).
 */
const refusal = (cause: string, repair: string): string =>
  `REFUSE: ${cause}, so this window cannot be computed. Process nothing and ` +
  `advance no cursor this tick; ${repair}`;

/** The refusal a cursor that names no commit in this tree renders. */
const unresolvedCursor = (
  field: CursorField,
  cursor: string,
  flumeDir: string,
): string =>
  refusal(
    `\`${field}\` is \`${cursor}\`, which does not resolve to a commit in ` +
      `this tick's tree`,
    `repair \`${field}\` in ${stateFileFor(field, flumeDir)} and say in ` +
      `the commit body what it was and what you set it to.`,
  );

/**
 * The bound `touchedPast`'s fail-open already promises (`gitRange.ts`): every
 * way a render reads the tree — the bootstrap listing, the range scan, a
 * commit's diff, the retired-claim diff — arrives here as the named refusal
 * rather than as a throw out of `promptArgs`. Not git's failures alone,
 * because a refusal that classified what it caught would be guessing at a
 * cause it was never told; the failure's own text is carried instead.
 *
 * The cursor is untouched by a failure this side of the render, so the
 * window re-opens over the same range next tick; the tick that was woken
 * says what it saw instead of dying silently.
 *
 * The text is the failure's own, folded by the package's one reader of that
 * ({@link detailOf}, `harness/exec.ts`) — so a git that refused reaches the
 * prompt saying what git said, rather than under the command line the window
 * already names.
 */
function bounded(
  field: CursorField,
  ctx: WindowContext,
  render: () => string,
): string {
  try {
    return render();
  } catch (err) {
    return refusal(
      `the \`${field}\` window could not be read: ${detailOf(err)}`,
      `say in the commit body what failed; \`${field}\` in ` +
        `${stateFileFor(field, ctx.flumeDir)} is untouched, so the window ` +
        `re-opens over the same range next tick.`,
    );
  }
}
