/**
 * stateRootAccess — the refusal an *access* under the state root raises, and
 * the reads and writes that raise it.
 *
 * Sibling to `src/fsProbe.ts`, which holds the loud existence probes: that
 * module answers what is *at* a path, this one answers what happened when
 * something under a root was read or made. One class covers both directions
 * because the operator's fact is the same at either — which resolved root is
 * unusable — and because the CLI classifies it at one arm: a second class
 * would be a second arm, one direction behind the next reader added
 * (`.claude/rules/engineering.md`, *The fix lands at the mechanism*).
 *
 * Nothing beyond `node:fs`, `node:path`, `src/paths.ts` and `src/fsProbe.ts`
 * here, so the baton, the dispatcher, and any other reader or writer under the
 * state root can reach it without a cycle.
 */

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { isDirectoryOrAbsentUnder } from "./fsProbe.js";
import { namespacedJoin } from "./paths.js";
import { thrownMessage } from "./thrown.js";

/**
 * An access under the state root that failed, named with **the root the
 * process resolved** rather than the leaf the errno carried.
 *
 * Which root a walk — or a relocating `FLUME_DIR` — picked is the thing an
 * operator cannot infer from `<root>/.flume/awake`, and it is the thing that
 * is unusable: the leaf is a symptom of it. The errno's own sentence rides
 * along as the detail, so nothing about the failure is lost.
 *
 * One class, thrown where the access fails and reported by the seam that owns
 * the process's exit code (`src/cli.ts`, `EX_IOERR`) — so a second reader or
 * writer adopting {@link mkdirUnderStateRoot} or {@link readUnderStateRoot}
 * reaches the operator as a sentence rather than through the CLI's raw-stack
 * arm, with no per-verb copy of the report.
 */
export class StateRootAccessError extends Error {
  /** The resolved state root the failed access was under. */
  readonly stateRoot: string;

  /**
   * @param stateRoot the resolved state root, as the caller answers for it
   * @param access which direction failed, as the sentence spells it
   * @param what the subject being accessed, as a bare noun phrase
   *   ("awake-flag directory")
   * @param cause the fs failure, carried for a caller that wants the errno
   */
  constructor(
    stateRoot: string,
    access: "read" | "written",
    what: string,
    cause: unknown,
  ) {
    super(
      `state root at ${stateRoot} cannot be ${access}: ${what} — ${
        thrownMessage(cause)
      }`,
      { cause },
    );
    this.stateRoot = stateRoot;
  }
}

/**
 * `mkdir -p` of `dir`, a directory under `stateRoot`, refusing as
 * {@link StateRootAccessError} rather than as a raw fs throw.
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
    throw new StateRootAccessError(stateRoot, "written", what, err);
  }
}

/**
 * Write `contents` to `file`, a leaf under `stateRoot`, refusing as
 * {@link StateRootAccessError} rather than as a raw fs throw.
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
    throw new StateRootAccessError(stateRoot, "written", what, err);
  }
}

/**
 * Remove `file`, a leaf under `stateRoot`, refusing as
 * {@link StateRootAccessError} rather than as a raw fs throw.
 *
 * Absence is the one tolerated reading, and the only one: removing a leaf
 * that was never there is the idempotence every marker under this root is
 * specced for. Everything else — a directory standing where the leaf belongs,
 * an obstructed ancestor, permission denied — is a removal that did **not**
 * happen, and a marker silently left standing is the next tick's wrong answer
 * (`.claude/rules/engineering.md`, *Loud or nothing*). A removal is a write of
 * the directory that holds the leaf, so it refuses in the write's own
 * direction rather than in a class of its own.
 *
 * That tolerated absence is **proven**, never read off the errno. Win32
 * answers an unlink beneath a plain file `ENOENT`, the code an absent leaf
 * answers too (`.claude/rules/platform-facts.md`, *win32 reports a path
 * through a non-directory as not found*), so an errno arm alone reports a
 * removal that never happened on that host while refusing on posix — one
 * marker, two hosts, two answers. The proof is the descent every reader's
 * silent arm already takes (`isDirectoryOrAbsentUnder`, `src/fsProbe.ts`),
 * shared rather than respelled beside it
 * (`.claude/rules/engineering.md`, *The fix lands at the mechanism*): from
 * `stateRoot` down to the directory holding the leaf, each rung asserted a
 * directory, so the `ENOENT` left past it is the leaf's own and nothing
 * else's. The descent runs inside the `try` because its refusal is this
 * root's too, and reaches the operator as this module's one sentence.
 *
 * `stateRoot` and `file` are plain paths — the descent namespaces its own
 * rungs, and the leaf is folded here for the reason the two writes above fold
 * their own.
 */
export function removeUnderStateRoot(
  stateRoot: string,
  what: string,
  file: string,
): void {
  try {
    if (!isDirectoryOrAbsentUnder(what, stateRoot, dirname(file))) return;
    rmSync(namespacedJoin(file));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
    throw new StateRootAccessError(stateRoot, "written", what, err);
  }
}

/**
 * Run `read` — a reader of something under `stateRoot` — refusing whatever it
 * throws as {@link StateRootAccessError} rather than as a raw fs throw.
 *
 * A wrapper rather than a reader of its own, because a read under this root
 * is never one call: the silent arm every one of them wants is a **proven**
 * absence, which is a descent (`isDirectoryOrAbsent`, `src/fsProbe.ts`) and
 * then the read. What the caller keeps is where its own silent arm sits; what
 * this owns is that everything past that arm reaches the operator as the same
 * sentence, naming the same root, as the writes above
 * (`.claude/rules/engineering.md`, *The fix lands at the mechanism*).
 *
 * The caller folds its own paths for win32, as it would with no wrapper here.
 */
export function readUnderStateRoot<T>(
  stateRoot: string,
  what: string,
  read: () => T,
): T {
  try {
    return read();
  } catch (err) {
    throw new StateRootAccessError(stateRoot, "read", what, err);
  }
}
