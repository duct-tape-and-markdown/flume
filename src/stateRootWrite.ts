/**
 * stateRootWrite — the refusal a *write* under the state root raises, and the
 * mkdir and file-write that raise it.
 *
 * Sibling to `src/fsProbe.ts`, which holds the loud existence probes: that
 * module answers what is *at* a path, this one answers what happened when
 * something was made under a root. A write failure is not the read family's
 * ENOENT-vs-other split — there is no silent arm here at all — so it is its
 * own job and its own file (`.claude/rules/engineering.md`, *A module is one
 * job*).
 *
 * Nothing beyond `node:fs` and `src/paths.ts` here, so the baton, the
 * dispatcher, and any other writer under the state root can reach it without
 * a cycle.
 */

import { mkdirSync, writeFileSync } from "node:fs";

import { namespacedJoin } from "./paths.js";

/**
 * A write under the state root that failed, named with **the root the process
 * resolved** rather than the leaf the errno carried.
 *
 * Which root a walk — or a relocating `FLUME_DIR` — picked is the thing an
 * operator cannot infer from `<root>/.flume/awake`, and it is the thing that
 * is unusable: the leaf is a symptom of it. The errno's own sentence rides
 * along as the detail, so nothing about the failure is lost.
 *
 * One class, thrown where the write fails and reported by the seam that owns
 * the process's exit code (`src/cli.ts`, `EX_IOERR`) — so a second writer
 * adopting {@link mkdirUnderStateRoot} reaches the operator as a sentence
 * rather than through the CLI's raw-stack arm, with no per-verb copy of the
 * report — and why a second *kind* of write under the root is a sibling here
 * rather than its own refusal (`.claude/rules/engineering.md`, *The fix lands
 * at the mechanism*).
 */
export class StateRootWriteError extends Error {
  /** The resolved state root the failed write was under. */
  readonly stateRoot: string;

  /**
   * @param stateRoot the resolved state root, as the caller answers for it
   * @param what the subject being written, as a bare noun phrase
   *   ("awake-flag directory")
   * @param cause the fs failure, carried for a caller that wants the errno
   */
  constructor(stateRoot: string, what: string, cause: unknown) {
    super(
      `state root at ${stateRoot} cannot be written: ${what} — ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
      { cause },
    );
    this.stateRoot = stateRoot;
  }
}

/**
 * `mkdir -p` of `dir`, a directory under `stateRoot`, refusing as
 * {@link StateRootWriteError} rather than as a raw fs throw.
 *
 * There is no tolerated failure: a recursive mkdir is already silent about a
 * directory that is simply there, so everything left — a plain file standing
 * where the directory belongs (`EEXIST`), an obstructed ancestor, permission
 * denied — is a root nothing can be made under, and every one of them is this
 * refusal (`.claude/rules/engineering.md`, *Loud or nothing*).
 *
 * `stateRoot` and `dir` are plain paths; the win32 total-path fold is spent
 * here, on the call, because the path arrived whole — and the refusal names
 * the plain root, which is the one an operator has to go fix
 * (`.claude/rules/platform-facts.md`, "Windows MAX_PATH (~260 chars) breaks
 * fs calls with no long component").
 */
export function mkdirUnderStateRoot(
  stateRoot: string,
  what: string,
  dir: string,
): void {
  try {
    mkdirSync(namespacedJoin(dir), { recursive: true });
  } catch (err) {
    throw new StateRootWriteError(stateRoot, what, err);
  }
}

/**
 * Write `contents` to `file`, a leaf under `stateRoot`, refusing as
 * {@link StateRootWriteError} rather than as a raw fs throw.
 *
 * The mkdir above makes the root; this makes a leaf in it, and the two fail
 * for the same reasons — a directory standing where the file belongs
 * (`EISDIR`), an obstructed ancestor, permission denied. None of them is
 * tolerated: a leaf the caller could not write is a flag the next tick will
 * read the absence of, which is the silent degradation this module exists to
 * refuse (`.claude/rules/engineering.md`, *Loud or nothing*). Sharing the
 * refusal rather than restating it beside each write is why the class names
 * the root and not the leaf (`.claude/rules/engineering.md`, *The fix lands at
 * the mechanism*).
 *
 * `stateRoot` and `file` are plain paths, folded here for the same reason the
 * mkdir folds its own: the path arrived whole, and the refusal names the plain
 * root an operator has to go fix.
 */
export function writeFileUnderStateRoot(
  stateRoot: string,
  what: string,
  file: string,
  contents: string,
): void {
  try {
    writeFileSync(namespacedJoin(file), contents);
  } catch (err) {
    throw new StateRootWriteError(stateRoot, what, err);
  }
}
