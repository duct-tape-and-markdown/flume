/**
 * The questions directory as disk holds it (`spec/harness.md`, *Records as
 * one file each*) — which questions are open under a state root, and the
 * block every plan slice's prompt is shown them in.
 *
 * **Presence is state.** An open question is one file, present while open and
 * deleted when answered, so a slice reads the fact off the listing rather
 * than out of a word inside a shared page: no heading grep, no status token,
 * no ruling left behind to tell "open" from "closed". Two sessions opening
 * two questions write two files and never conflict, which a page appended to
 * by line position cannot offer whatever its syntax.
 *
 * This module is the render alone. Where the directory sits is `layout.ts`'s,
 * with every other plan artifact's path; reading it is the shared listing's
 * (`dirListing.ts`), which the record queue takes its own answer from and
 * which is where this render's host-native paths and its absence arm are
 * stated; what a question *says* is the human's, and no slice derives
 * anything from it.
 */

import { join } from "node:path";

import { existsLoud } from "../src/fsProbe.js";
import { namespacedJoin } from "../src/paths.js";

import { listUnderStateRoot } from "./dirListing.js";
import {
  QUESTION_EXT,
  QUESTIONS_DIR_REL,
  legacyQuestionsPath,
} from "./layout.js";

/**
 * What the questions block says when nothing is open — the whole of it, so a
 * slice reads an empty directory and an absent one as the same fact.
 *
 * Spelled here rather than in the three prompts that carry the block: it is
 * the render's own answer, and a prompt restating it would be a second copy
 * of a string only this module produces (`.claude/rules/engineering.md`,
 * *Derived state is computed, never restated beside its source*).
 */
export const NONE_OPEN = "(none open)";

/**
 * The open questions as a plan slice's prompt carries them: one path per
 * open question, or {@link NONE_OPEN}.
 *
 * **Paths, not contents.** The block is an index — it says which questions
 * are open and where each one is, and the tick opens the one it is about to
 * amend or answer. Rendering every question's prose instead would re-inject
 * the whole backlog into every plan tick for the one question a tick touches
 * (`.claude/rules/collaboration.md`, *Match prose to the medium*).
 *
 * **A legacy page still on disk is named, never passed over.** A consumer
 * upgrading into this layout has questions open inside the page that
 * preceded the directory ({@link legacyQuestionsPath}), and nothing here
 * lists one; answering with the none-open line would hand plan a prompt
 * saying its parked forks are closed. So the page's presence is stated, with
 * what closes it, and it is the only thing that suppresses that line
 * (`.claude/rules/engineering.md`, *Loud or nothing*). It goes when the
 * constant behind it does, with the fence line that lets the drain delete the
 * page (`layout.ts`).
 *
 * **A directory this cannot read refuses too**, and only a *proven* absence
 * renders {@link NONE_OPEN}: a plain file at the state root or above the
 * questions directory is an input this render never resolved, and answering
 * it with the none-open line would tell a plan tick that a question it
 * cannot see is closed. The listing proves that absence by descent rather
 * than off an errno, so both hosts refuse alike and the refusal names the
 * path an operator has to go fix (`dirListing.ts`).
 */
export function renderQuestions(stateRoot: string): string {
  const open = listUnderStateRoot(
    "questions dir",
    stateRoot,
    QUESTIONS_DIR_REL,
    QUESTION_EXT,
  );
  const legacy = legacyQuestionsPath(stateRoot);
  if (!existsLoud(namespacedJoin(legacy))) {
    return open.length === 0 ? NONE_OPEN : open.join("\n");
  }
  return [
    ...open,
    `${legacy} — the legacy open-questions page is still on disk: move every ` +
      `question still open in it to its own file under ` +
      `${join(stateRoot, QUESTIONS_DIR_REL)}, then delete the page in the ` +
      `same commit.`,
  ].join("\n");
}
