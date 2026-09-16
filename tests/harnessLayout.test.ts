/**
 * The harness package's plan-artifact layout (`harness/layout.ts`): where each
 * artifact sits under a state root, and the fence that is their list.
 *
 * The fence case is an agreement case (`.claude/rules/engineering.md`, *A seam
 * gate reads what the real writer wrote*): every path is composed by the
 * accessor a real tick reaches that artifact through — the engine's own queue
 * resolver, the plan state's path, the questions directory's, a build note's
 * — and the list is judged by the engine's real `matchesAny`, the matcher the
 * fence gate runs. A hand-spelled path on either side would re-author one of them
 * by the tester's hand, and the one-sided rename is exactly what this is for.
 */

import { expect, it } from "vitest";

import {
  QUESTION_EXT,
  legacyQuestionsPath,
  noteGlob,
  notePath,
  planArtifacts,
  planStatePath,
  questionGlob,
  questionsDir,
  queuePath,
  recordDirs,
  underStateRoot,
} from "../harness/layout.ts";
import {
  DEFAULT_PENDING_REL,
  gitPath,
  matchesAny,
  resolvePendingPath,
} from "../src/paths.ts";

/** A state root as the engine reports one: repo-relative, in git's alphabet. */
const STATE_ROOT = ".flume";

it("the plan fence admits every artifact the package's own accessors address", () => {
  const fence = planArtifacts(STATE_ROOT);

  // Each artifact at the spelling its reader or writer composes, never one
  // spelled here: the queue through the engine's resolver every consumer of
  // it uses, the rest through the accessors the slices and gates call.
  //
  // The resolver answers host-native by declaration — a queue path is read
  // off disk, not handed to git — so its answer arrives here in the host's
  // alphabet and a fence glob is compared in git's. The fold is the engine's
  // own `gitPath` applied at this case, the one side that needs the
  // conversion; `queuePath` would be the fence's own accessor, which is the
  // fence agreeing with itself rather than with the resolver it is fenced
  // against.
  const artifacts = [
    gitPath(resolvePendingPath(STATE_ROOT)),
    planStatePath(STATE_ROOT),
    `${questionsDir(STATE_ROOT)}/a-parked-fork${QUESTION_EXT}`,
    legacyQuestionsPath(STATE_ROOT),
    notePath(STATE_ROOT, "SOME-ENTRY"),
    ...recordDirs(STATE_ROOT).map((dir) => `${dir}/2026-09-15-a-finding.md`),
  ];

  // Vacuity pin: an empty artifact list would pass every arm below by running
  // none, and an empty fence would be the failure this case exists to catch.
  expect(artifacts.length).toBeGreaterThan(0);
  expect(fence.length).toBeGreaterThan(0);

  for (const path of artifacts) {
    expect({ path, fenced: matchesAny(path, fence) }).toEqual({
      path,
      fenced: true,
    });
  }

  // And the fence is the artifacts' own list rather than a wider one: a path
  // under the state root that is no plan artifact stays outside it, so the
  // arms above are the list agreeing rather than a glob admitting everything.
  expect(matchesAny(`${STATE_ROOT}/chain.ts`, fence)).toBe(false);
  expect(matchesAny(`${STATE_ROOT}/plan/notes/a-note.txt`, fence)).toBe(false);
});

it("the plan fence admits a file under the questions directory", () => {
  // Presence is the state of a question (`spec/harness.md`, *Records as one
  // file each*), so opening one adds a file and answering one deletes it —
  // both are the plan commit's touched paths, and a fence that did not reach
  // them would revert the tick that asked or the tick that answered.
  const fence = planArtifacts(STATE_ROOT);
  expect(fence.length).toBeGreaterThan(0);

  // At the spelling the writer composes: the directory accessor every slice
  // prompt names, never a path spelled here.
  const question = `${questionsDir(STATE_ROOT)}/an-open-fork${QUESTION_EXT}`;
  expect(matchesAny(question, fence)).toBe(true);

  // And the glob that admits it is the questions directory's own, so the arm
  // above is the fence agreeing with the layout rather than a wider glob
  // admitting anything under the state root.
  expect(matchesAny(question, [questionGlob(STATE_ROOT)])).toBe(true);
  // Bounded on both sides: a question spelled a directory up is not one, and
  // neither is a file in the directory that is not markdown a human reads.
  expect(
    matchesAny(`${STATE_ROOT}/plan/an-open-fork${QUESTION_EXT}`, [
      questionGlob(STATE_ROOT),
    ]),
  ).toBe(false);
  expect(
    matchesAny(`${questionsDir(STATE_ROOT)}/.gitkeep`, [
      questionGlob(STATE_ROOT),
    ]),
  ).toBe(false);
});

it("the plan fence admits the legacy open-questions page a drain deletes", () => {
  // The migration allowance (`harness/layout.ts`): a consumer upgrading into
  // the questions directory has open questions inside the page, and the drain
  // that moves them out `git rm`s it in the same commit. Outside the fence,
  // that page is a file no phase can reach.
  const fence = planArtifacts(STATE_ROOT);
  expect(fence.length).toBeGreaterThan(0);
  expect(matchesAny(legacyQuestionsPath(STATE_ROOT), fence)).toBe(true);
});

it("the queue's fence path is the engine's resolved queue, in git's alphabet", () => {
  // One spelling for three readers — the plan fence, the adoption verb's
  // written line, and the gate that reads the queue at a commit. The engine's
  // resolver is the only place `plan/pending.json` is named, and this is the
  // fold that puts its answer in the alphabet a pathspec and a fence glob are
  // compared in.
  expect(queuePath(STATE_ROOT)).toBe(
    `${STATE_ROOT}/${gitPath(DEFAULT_PENDING_REL)}`,
  );
  expect(planArtifacts(STATE_ROOT)).toContain(queuePath(STATE_ROOT));
});

it("a path under a state root is git-alphabet whatever alphabet its tail arrived in", () => {
  // The tail a host composed, which is what `gates.ts` holds: the queue's
  // offset from the state root comes off `relative()`, so on win32 it carries
  // backslashes, and a backslash in a pathspec matches nothing there.
  expect(underStateRoot(STATE_ROOT, String.raw`plan\pending.json`)).toBe(
    `${STATE_ROOT}/plan/pending.json`,
  );

  // A tail already in git's alphabet is untouched — the same answer, so the
  // fold is a normalization rather than a second dialect of its own.
  expect(underStateRoot(STATE_ROOT, "plan/pending.json")).toBe(
    `${STATE_ROOT}/plan/pending.json`,
  );

  // And build's glob names the directory its notes go in, so the fence and
  // the path a parking tick writes cannot end up under different directories.
  const note = notePath(STATE_ROOT, "SOME-ENTRY");
  expect(matchesAny(note, [noteGlob(STATE_ROOT)])).toBe(true);
  // The glob is that directory's alone: a note spelled a directory up is not
  // the path the records gate looks for, so the arm above is the two agreeing
  // rather than a glob that admits anything named for the tag.
  expect(
    matchesAny(`${STATE_ROOT}/plan/SOME-ENTRY.md`, [noteGlob(STATE_ROOT)]),
  ).toBe(false);
});
