# Protocol — project conventions

<!--
Written by `flume-harness init`, and yours from here: this file is never
rewritten by an upgrade. Fill the placeholders in, delete what does not
apply, and add whatever a fresh tick could not derive from the tree.

What does NOT belong here: anything the harness package already owns — the
plan slices and their order, the judges, the record cap, the gates, the
entry extension's fields. Those ship with `@dtmd/flume/harness` and are
declared, not restated (`spec/harness.md`). What belongs here is the part of
this project no declaration encodes.
-->

Runtime mechanics — the phases, their prompts, the gates, the entry
extension, the judges — ship in the harness package and are configured in
`{{STATE_ROOT}}/declaration.ts`. This file holds the project-side conventions
no declaration encodes.

## The chain

<!-- The artifacts this project derives, in order, e.g.
     `spec/*.md` -> `{{STATE_ROOT}}/plan/` -> `src/` -> git log -->

## What an entry means here

An entry is a contract between two ticks that never meet: a plan tick writes
it, a fresh build process reads it with no shared memory and no access to the
reasoning that produced it. **Plan states the contract; build chooses the
implementation.**

<!-- What a good entry looks like in this project. Some starting bars:

1. One tick's work — if it cannot land as one commit with green gates, it is
   two entries, a spec change, or a decision nobody has made.
2. Independently shippable — its gates pass on its own.
3. Cited, not invented — `per` resolves to a section that justifies *this*
   work. An entry that cannot carry a clean cite is an open question.
4. Acceptance is decidable — someone who did not write it runs it and gets
   yes or no.
-->

## Lanes

<!-- Who writes what, and with which commit prefix. One author per artifact;
     a layer that reaches into another's lane is how the pipeline's trust
     collapses.

| Layer | Artifact | Author | Commit prefix |
| ----- | -------- | ------ | ------------- |
|       |          |        |               |
-->

## Records

A finding for plan and a note from a build tick are **records**: one file
each, drained by the inbox slice and deleted on the way out. The paths, the
title line, and the byte cap are the package's (`spec/harness.md`, *Records
as one file each*) — the cap measured in bytes, and reported by the drain
rather than reverted by the records gate; what belongs in one here is this
project's:

- **Inbox** — `{{STATE_ROOT}}/inbox/<YYYY-MM-DD>-<slug>.md`, from whoever
  observes something in the field.
- **Build notes** — `{{STATE_ROOT}}/plan/notes/<TAG>.md`, from the build tick
  assigned that entry and no other: an observation for the next plan tick,
  written by a tick that shipped.
- **Build parks** — `{{STATE_ROOT}}/plan/notes/parked/<TAG>.md`, the same note
  one directory down. **The directory is the signal**: the entry cannot ship
  as written and stays in the queue, whatever else that commit touched.

## Disk vs git log

When asking "did X ship?" or "is gate Y satisfied?", read the disk artifact —
the queue at `{{STATE_ROOT}}/plan/pending.json`, or the source file itself.
Git log is orientation, not authority.

## Push policy

<!-- Whether a phase pushes, to which branch, and after which gate. -->
