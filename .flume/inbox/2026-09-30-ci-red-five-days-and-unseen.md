# CI red for five days, and the loop's lanes could not see it

Last green CI run: 2026-09-25T19:16Z (76262932). Since then 64 consecutive
red runs of ci.yml. The `windows` job went red first (2026-09-25T20:56Z);
the `ci` (posix) job went red 2026-09-29T21:57Z. Failing on run 36745870387
(tip 88061fd8):

posix (1):
- tests/Dispatcher.test.ts > a merge-stage throw outside the ledger rewrite
  carries the settled wave's verdict > ... names the spans it already shipped
  — `expected ['STAKE-B','STAKE-A'] to deeply equal ['STAKE-A','STAKE-B']`:
  an order assertion over spans a concurrent wave lands in either order.

windows (≥8):
- checkoutAddress — separates the primary checkout from a linked one ...
  — `expected 'C:/Users/...' to be 'C:\Users\...'`: git's alphabet vs the
  host's (`posture-sweep.md`, the `node:path` lens).
- tests/cli.test.ts > flume sleep over an unwritable awake-flag directory
  refuses with the state-root write refusal — `expected 0 to be 74`:
  `platform-facts.md`, *`chmod` denies nothing on win32*.
- tests/cliHelp.test.ts > the state-root access refusal, per verb — the
  pages rendering the shared clause differ from the verbs that take it
  (`sleep` present on one side only).
- tests/Dispatcher.test.ts > a recorded ledger refusal outranks a slot leg's
  throw; > a walled wave reports every wall it held (two cases) —
  `ENOENT ... .flume\worktrees\boom-b\.git`, then `expected undefined`.
- tests/Dispatcher.test.ts > win32 total-path limit
  (DISPATCHER-NAMESPACEDJOIN-WIN32-PATH-TOTAL-LIMIT) > readPending ... don't
  misread an existing queue as absent when pendingDir exceeds ~260 chars —
  `expected [] to deeply equal ['RELOC-W32']`: a queue read that now misses
  the long-path arm — likely the tip-pinned read (A-READ-AT-A-REF-...), a
  real win32 regression, not a test artifact.
- tests/Dispatcher.test.ts > a wave whose slot leg throws outside a ledger
  read still writes the settled wave's verdict; > the verdict a wave writes
  after a slot leg throws names every span it landed — `expected undefined`.

Each is a defect fix and ships the test that would have caught it; the
posix order case is an order assertion over a set, not a flake to retry.

## The lane is blind while the loop is busy

Why none of this reached plan: every plan-inbox prompt this week rendered
both lanes `UNREAD` — "the newest completed run ... was made on commit X, and
this tree's tip is Y, so that run judged another tree ... file nothing and
close nothing against it" (`spec/harness.md`, *CI lanes as a findings
source*). A run takes ~20 min and the loop commits every few minutes, so the
newest completed run is never on the tip, and a declared lane files nothing
for as long as the loop is productive — exactly when it is needed. The rule's
reason (a stale run must not read as current) is sound; its consequence is a
findings source that goes dark under load. Likely a question: e.g. read a red
title from a run on an ancestor of the tip as still standing until a run at
or after the fixing commit says otherwise, while green still requires the
tip's own run.
