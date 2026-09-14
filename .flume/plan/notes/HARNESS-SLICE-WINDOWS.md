# Windows ship unwired; the span-neutralization ruling is still one entry away

`harness/windows.ts` supplies SPEC_WINDOW, SWEEP_WINDOW, RECORDS and
BUILD_RECORDS, but nothing installs them as a phase's `promptArgs` yet — no
chain factory exists. The open question "the harness package widens this to
every byte of a plan window" is therefore **not** armed by this commit; it
arms at the factory entry. Rule on it before filing that one.

Two calls made mid-run, both deliberate:

- The standing-refusal leg classifies by `PLAN_RESOLVES_NO_COMMIT`
  (`harness/handoff.ts`, now exported) plus `not-shipped: true` /
  `tip-moved: false`, so a standing `render-refused` record also holds the
  inbox window open. The entry's note said clean-exit and not-shipped only;
  a second table beside the handoff's would let a mode route to the inbox
  from a `TickResult` and nowhere from a record (engineering.md, *The fix
  lands at the mechanism*).
- `recordsPending` now delegates to a new `recordFiles`, so the inbox's
  liveness leg and its rendered RECORDS block walk one listing.
