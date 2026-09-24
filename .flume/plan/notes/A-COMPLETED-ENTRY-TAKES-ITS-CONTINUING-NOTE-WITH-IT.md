# The removal the gate forces was read as a continuation

The entry's mechanic — build's own commit removes the note — was unshippable
against `putDown` in `harness/chain.ts` as the tree held it: it read
`touched.includes(continuingNotePath(...))`, and a deleted path is a touched
one, so the completing commit would classify as `continuing`, `shipped` would
return false, and the finished entry would sit in the queue until a later tick
parked on "already shipped". The gate alone would cost two ticks per
continuation.

So this tick shipped the predicate fix beside the gate: the continuing arm now
reads the note as one that **stands** (touched *and* present in the span's
tree), which is what `spec/harness.md` already says — "a commit *carrying* a
note at that path". The park arm is unchanged and still reads the touch, because
plan drains parks and a build commit only ever writes one; making that arm
presence-based would keep an entry in the queue whenever a build wave re-picked
it before a plan drain. The asymmetry is stated at the site.

That needed a tree root at three call sites, so the vocabulary moved out of
`chain.ts` into `harness/putDown.ts` (`putDownPredicate(stateRoot)`, plus the
`PutDownKind`/`PutDownSpan`/`PutDownPredicate` types, re-exported from
`harness/index.ts` — the export pin reaches them through `HarnessGatesOptions`).
`harnessGates` now takes the predicate, the way `namedLinesGate` already did.

`THE-NEXT-TICK-ON-AN-ENTRY-IS-HANDED-ITS-CONTINUING-NOTE` is now the last
missing half of the loop: the note is written, refused if orphaned, and removed
on completion, but nothing renders it into the next tick's prompt. Until it
lands, a continuing tick's successor is told to remove a file it was never
shown.

Also: the records gate's "no record in the gated span" skip no longer covers a
build span carrying an entry — such a span always judges the continuation
claim. Two existing cases moved to a plan-slice context or to the judged
verdict.
