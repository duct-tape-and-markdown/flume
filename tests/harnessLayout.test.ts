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

import { PLAN_SLICES, type PlanSlice } from "../harness/declaration.ts";
import {
  QUESTION_EXT,
  continuingNotePath,
  continuingNotesDir,
  legacyPlanStatePath,
  legacyQuestionsPath,
  noteGlobs,
  notePath,
  notePaths,
  notesDir,
  parkedNotePath,
  parkedNotesDir,
  planArtifacts,
  planStatePath,
  questionGlob,
  questionsDir,
  queueDir,
  queueGlob,
  legacyQueuePath,
  recordDirs,
  underStateRoot,
} from "../harness/layout.ts";
import {
  DEFAULT_PENDING_REL,
  gitPath,
  matchesAny,
  resolvePendingDir,
} from "../src/paths.ts";

/** A state root as the engine reports one: repo-relative, in git's alphabet. */
const STATE_ROOT = ".flume";

/**
 * The slice a fence case is drawn for, where the case is not about which
 * slice it is. Plan state is one file per writer, so `planArtifacts` is per
 * slice; every other artifact in it is shared, and a case about one of those
 * names a slice only because the fence has to be asked for one.
 */
const SOME_SLICE: PlanSlice = "plan-derive";

it("the plan fence admits every artifact the package's own accessors address", () => {
  const fence = planArtifacts(STATE_ROOT, SOME_SLICE);

  // Each artifact at the spelling its reader or writer composes, never one
  // spelled here: the queue through the engine's resolver every consumer of
  // it uses, the rest through the accessors the slices and gates call.
  //
  // The resolver answers host-native by declaration — a queue path is read
  // off disk, not handed to git — so its answer arrives here in the host's
  // alphabet and a fence glob is compared in git's. The fold is the engine's
  // own `gitPath` applied at this case, the one side that needs the
  // conversion; `queueDir` would be the fence's own accessor, which is the
  // fence agreeing with itself rather than with the resolver it is fenced
  // against. An entry's own file under it, because the queue's fence line is
  // a glob over the directory rather than the directory itself.
  const artifacts = [
    `${gitPath(resolvePendingDir(STATE_ROOT))}/SOME-ENTRY.json`,
    legacyQueuePath(STATE_ROOT),
    planStatePath(STATE_ROOT, SOME_SLICE),
    `${questionsDir(STATE_ROOT)}/a-parked-fork${QUESTION_EXT}`,
    legacyQuestionsPath(STATE_ROOT),
    notePath(STATE_ROOT, "SOME-ENTRY"),
    parkedNotePath(STATE_ROOT, "SOME-ENTRY"),
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
  const fence = planArtifacts(STATE_ROOT, SOME_SLICE);
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
  const fence = planArtifacts(STATE_ROOT, SOME_SLICE);
  expect(fence.length).toBeGreaterThan(0);
  expect(matchesAny(legacyQuestionsPath(STATE_ROOT), fence)).toBe(true);
});

it("each plan slice's fence admits its own state file and no sibling's", () => {
  // Vacuity pin: one slice would make every exclusion arm below trivial, and
  // the property is what two slices writing at once cannot do
  // (`.claude/rules/engineering.md`, *A green verdict is proven
  // non-vacuous*).
  expect(PLAN_SLICES.length).toBeGreaterThan(1);

  for (const slice of PLAN_SLICES) {
    const fence = planArtifacts(STATE_ROOT, slice);
    expect(fence.length).toBeGreaterThan(0);

    // Its own, at the spelling the accessor its tick writes through composes.
    const own = planStatePath(STATE_ROOT, slice);
    expect({ slice, fenced: matchesAny(own, fence) }).toEqual({
      slice,
      fenced: true,
    });

    // And no sibling's: the fence is how "no slice writes a cursor it does
    // not own" (`spec/harness.md`, *Plan state as declared state*) is held by
    // the fence gate rather than by a prompt paragraph.
    for (const other of PLAN_SLICES) {
      if (other === slice) continue;
      const sibling = planStatePath(STATE_ROOT, other);
      expect({ slice, other, fenced: matchesAny(sibling, fence) }).toEqual({
        slice,
        other,
        fenced: false,
      });
    }
  }
});

it("the plan fence admits the legacy plan state page a split deletes", () => {
  // The migration allowance (`harness/layout.ts`): a consumer upgrading into
  // the per-slice state files holds its cursors in the single page, and the
  // tick that splits them `git rm`s it in the same commit. Outside the fence,
  // that page is a file no phase can reach. Every slice, because which one
  // runs first is the loop's call and not the layout's.
  expect(PLAN_SLICES.length).toBeGreaterThan(0);
  for (const slice of PLAN_SLICES) {
    const fence = planArtifacts(STATE_ROOT, slice);
    expect({
      slice,
      fenced: matchesAny(legacyPlanStatePath(STATE_ROOT), fence),
    }).toEqual({ slice, fenced: true });
  }

  // And it is not one of the per-slice files wearing the old name: the page
  // the split deletes and the file a slice writes are different paths.
  for (const slice of PLAN_SLICES) {
    expect(planStatePath(STATE_ROOT, slice)).not.toBe(
      legacyPlanStatePath(STATE_ROOT),
    );
  }
});

it("the queue's fence path is the engine's resolved queue directory, in git's alphabet", () => {
  // One spelling for three readers — the plan fence, the adoption verb's
  // written line, and the gate that reads the queue at a commit. The engine's
  // resolver is the only place `plan/pending` is named, and this is the
  // fold that puts its answer in the alphabet a pathspec and a fence glob are
  // compared in.
  expect(queueDir(STATE_ROOT)).toBe(
    `${STATE_ROOT}/${gitPath(DEFAULT_PENDING_REL)}`,
  );

  // The fence line is the glob, so an entry file is admitted and the
  // directory's own sidecars are not.
  expect(queueGlob(STATE_ROOT)).toBe(`${queueDir(STATE_ROOT)}/*.json`);
  expect(planArtifacts(STATE_ROOT, SOME_SLICE)).toContain(
    queueGlob(STATE_ROOT),
  );
  expect(matchesAny(`${queueDir(STATE_ROOT)}/SOME-ENTRY.json`, [
    queueGlob(STATE_ROOT),
  ])).toBe(true);
  expect(matchesAny(`${queueDir(STATE_ROOT)}/.gitkeep`, [
    queueGlob(STATE_ROOT),
  ])).toBe(false);
});

it("the legacy queue page rides the plan fence so a cutover can git rm it", () => {
  // The one reason it is still addressable (`harness/layout.ts`): outside
  // the fence, the page the cutover deletes is a file no phase can reach and
  // every plan tick reverts on.
  expect(legacyQueuePath(STATE_ROOT)).toBe(`${STATE_ROOT}/plan/pending.json`);
  expect(legacyQueuePath(STATE_ROOT)).not.toBe(queueDir(STATE_ROOT));
  expect(
    matchesAny(legacyQueuePath(STATE_ROOT), planArtifacts(STATE_ROOT, SOME_SLICE)),
  ).toBe(true);
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

  // And build's globs name the directories its notes go in, so the fence and
  // the paths a tick writes cannot end up under different directories.
  const globs = noteGlobs(STATE_ROOT);
  for (const note of [
    notePath(STATE_ROOT, "SOME-ENTRY"),
    parkedNotePath(STATE_ROOT, "SOME-ENTRY"),
  ]) {
    expect({ note, fenced: matchesAny(note, globs) }).toEqual({
      note,
      fenced: true,
    });
  }
  // Each glob is its own directory's alone: a note spelled a directory up is
  // not the path the records gate looks for, and — the two directories being
  // nested — the observation glob does not reach the parked note, which is
  // the whole distinction the park predicate reads.
  expect(matchesAny(`${STATE_ROOT}/plan/SOME-ENTRY.md`, globs)).toBe(false);
  expect(
    matchesAny(parkedNotePath(STATE_ROOT, "SOME-ENTRY"), [
      `${notesDir(STATE_ROOT)}/*.md`,
    ]),
  ).toBe(false);
});

it("a build note's kind is the directory it sits in", () => {
  // The spelling the spec states (`spec/harness.md`, *Records as one file
  // each*: a note that parks its entry lives under `notes/parked/`), pinned
  // here against the accessors every reader composes with — the fence, the
  // records gate, the build prompt and the park predicate all address a note
  // through one of these three.
  expect(notesDir(STATE_ROOT)).toBe(`${STATE_ROOT}/plan/notes`);
  expect(parkedNotesDir(STATE_ROOT)).toBe(`${STATE_ROOT}/plan/notes/parked`);
  expect(parkedNotePath(STATE_ROOT, "SOME-ENTRY")).toBe(
    `${STATE_ROOT}/plan/notes/parked/SOME-ENTRY.md`,
  );

  // Same tag, same extension, one segment apart: nothing but the directory
  // tells the two apart, which is what makes the location the kind.
  expect(parkedNotePath(STATE_ROOT, "SOME-ENTRY")).not.toBe(
    notePath(STATE_ROOT, "SOME-ENTRY"),
  );
  expect(notePaths(STATE_ROOT, "SOME-ENTRY")).toEqual([
    notePath(STATE_ROOT, "SOME-ENTRY"),
    parkedNotePath(STATE_ROOT, "SOME-ENTRY"),
    continuingNotePath(STATE_ROOT, "SOME-ENTRY"),
  ]);

  // And both directories are record directories, so the drain lists a park
  // the way it lists every other record and the plan fence admits its
  // deletion.
  const dirs = recordDirs(STATE_ROOT);
  expect(dirs).toContain(notesDir(STATE_ROOT));
  expect(dirs).toContain(parkedNotesDir(STATE_ROOT));
});

it("the continuing note directory is a note home the build fence admits", () => {
  // The spelling the spec states (`spec/harness.md`, *A tick puts work down*:
  // a continuing note at `notes/continuing/<TAG>.md`), pinned against the
  // accessors every reader composes with rather than spelled at each of them.
  expect(continuingNotesDir(STATE_ROOT)).toBe(
    `${STATE_ROOT}/plan/notes/continuing`,
  );
  const continuing = continuingNotePath(STATE_ROOT, "SOME-ENTRY");
  expect(continuing).toBe(`${STATE_ROOT}/plan/notes/continuing/SOME-ENTRY.md`);

  // Same tag, same extension, one segment apart from each of the others:
  // nothing but the directory tells the three kinds apart, which is what
  // makes the location the kind.
  const kinds = [
    notePath(STATE_ROOT, "SOME-ENTRY"),
    parkedNotePath(STATE_ROOT, "SOME-ENTRY"),
    continuing,
  ];
  expect(new Set(kinds).size).toBe(kinds.length);
  // And the set a tick may write names it, so the records gate holds a
  // continuation to the tick's own tag the way it holds the other two.
  expect(notePaths(STATE_ROOT, "SOME-ENTRY")).toEqual(kinds);

  // Build's fence globs, judged by the engine's real matcher: a home the
  // fence did not admit would have the commit carrying the note reverted.
  const globs = noteGlobs(STATE_ROOT);
  // Vacuity pin: an empty glob list would pass the arm below by admitting
  // nothing and matching nothing.
  expect(globs.length).toBeGreaterThan(0);
  expect(matchesAny(continuing, globs)).toBe(true);

  // Each glob is its own directory's alone. The three directories nest, so a
  // sibling's glob reaching this note would collapse exactly the distinction
  // the continuation is declared by.
  expect(matchesAny(continuing, [`${notesDir(STATE_ROOT)}/*.md`])).toBe(false);
  expect(matchesAny(continuing, [`${parkedNotesDir(STATE_ROOT)}/*.md`])).toBe(
    false,
  );

  // A note home and not a record queue: no drain lists it and the plan fence
  // does not admit its deletion, because a continuation is build's channel to
  // its own next tick on the entry rather than anything plan reconciles.
  expect(recordDirs(STATE_ROOT)).not.toContain(continuingNotesDir(STATE_ROOT));
  expect(matchesAny(continuing, planArtifacts(STATE_ROOT, SOME_SLICE))).toBe(
    false,
  );
});
