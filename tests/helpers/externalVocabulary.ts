/**
 * Vocabulary this repo's prose cites by name and legitimately does not
 * declare. Two reasons reach that: something outside the citing scan's reach
 * owns the name, or this repo retired the surface and a comment names what is
 * gone on purpose — the second has no owner at all, and resolving it would
 * contradict the sentence citing it. Either way no rung of the ladder here
 * can hold the name, and a scan says so by name rather than widening its
 * resolution until the residue disappears.
 *
 * One list for every reader, because an exclusion is a claim about the name
 * rather than about the reader that met it: a page an example chain writes
 * only into a consumer's repo is external whether a `tests/` comment, the
 * example itself, or an interface page is the one citing it. Each entry's
 * non-vacuity is therefore read over the union of every judged set.
 *
 * The reason rides the entry rather than the list, because an exclusion is
 * the one place a verdict is overridden by hand: a name added without one is
 * indistinguishable from residue nobody wanted to look at.
 *
 * **The list is data, not a module, and that is load-bearing.** A string
 * literal resolves a citation, and `tests/` is a judged tree, so a list
 * spelling the names it excuses would resolve every one of them from inside
 * the program and leave its pin green over an empty override. A `.json` no
 * module imports is in no program, which is why this reader reads it off disk
 * and never imports it.
 *
 * Not *.test.ts, so neither vitest lane collects it as a suite of its own.
 */

import { readFileSync } from "node:fs";

/** Every excused name, against the reason it is excused. */
export const externalVocabulary = (): ReadonlyMap<string, string> =>
  new Map(
    Object.entries(
      JSON.parse(
        readFileSync(
          new URL("./external-vocabulary.json", import.meta.url),
          "utf8",
        ),
      ) as Record<string, string>,
    ),
  );
