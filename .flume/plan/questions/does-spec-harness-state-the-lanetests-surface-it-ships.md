# Does `spec/harness.md` state the `laneTests[]` surface the package ships?

From A-HOST-GATED-CASE-RIDES-LANETESTS-OWED-TO-ITS-LANE's note, whose first
half filed as an entry. Two passages of the spec were verified against the
tree this tick and both describe a package one field and one report-half
smaller than the one that shipped. `spec/` is the human's surface, so this is
the ask rather than an edit.

## 1. *The entry extension* enumerates the fields and omits `laneTests[]`

The section's own position is that the roster is not its job — "held by the
package's schema rather than by a roster here" — and then the sentence
enumerates anyway: "a summary, a `per` cite, an acceptance criterion, the
`tests[]` and `pins[]` lines the judge proves, a note to plan, the
contract-touching flag ... and the interface an entry intends". Eight items,
and `laneTests[]` is not among them. It is declared one section later, in
*The judges*, and `docs/CHAIN-AUTHORING.md:62` — a page the suite pins
against the package — enumerates the eight the package actually ships, with
`laneTests[]` among them.

One of the eight items here is not a lag in the other direction and is **not**
part of this question: `interface` arrived in `8e7f1bfd`, which is past the
derive cursor, so the package not shipping it yet is derive's open work and
nothing for a human to answer. The finding is `laneTests[]` alone — a field
that has shipped, is pinned on the authoring page, and is missing from the
contract section a consumer reads first.

- **(a) Add the field to the enumeration.** Cheapest, and keeps the sentence
  useful as the one place a reader sees the whole set. Cost: the roster the
  section disclaims is now a roster that has to be maintained, and it has
  already lagged once.
- **(b) Drop the enumeration and keep the disclaimer.** The sentence becomes
  "the fields the package's discipline reads, with their caps and their
  hints, held by the package's schema", and the reader goes to the rendered
  schema or to `docs/CHAIN-AUTHORING.md` for the set. Cost: the contract
  section stops naming what the contract carries, which is a real loss for a
  consumer reading the spec before the code.
- **(c) Leave it.** The field is declared in *The judges*, so the spec does
  state it somewhere. Cost: the enumeration keeps reading as complete.

I would take (a) now and (b) if it lags again — the disclaimer already
predicts this failure, so a second lag is the evidence that the enumeration
cannot be kept beside a schema that grows.

**It has lagged again, one page over.** `spec/chain.md`, *What a hook
receives* enumerates `TickResult`'s existing facts in the same parenthetical
shape; that list last grew with `priorAttempts`, and `platformFailures`
reached `TickResult` after it (`cb20a56a`), so it is one field short today.
That page is **not** a third item below, because it carries the sentence this
one lacks — "a field the type carries and no bullet names is not absent" — so
its omission is ruled rather than open. It is evidence on the fork above: an
enumeration lags beside a disclaimer as readily as without one, and only (b)
retires the upkeep. Should you take (a), `spec/chain.md` is worth reading in
the same pass for whether its non-naming rule is meant to cover its own
parenthetical as well as its bullets.

## 2. *The runner interface* describes `run`'s report as passing-only

The bullet reads: "**`run(names, cwd)`** — run the tests whose full names
contain each of `names` and report, per name, whether one passing test
carried it." The shipped report carries a second, independent field:
`skipped` (`harness/runner.ts:101`) — true when at least one skipped test's
full name contains the line.

That half is not decoration; it is the whole of what makes a `laneTests[]`
line judgeable. The judge drafts a host-gated line as
`carried || skipped ? "owed" : "unnamed"`, and an `unnamed` line is refused.
A consumer who writes a runner against this bullet alone reports `skipped:
false` — which the package explicitly permits for a tool with no notion of a
skipped case — and then **every** `laneTests[]` line that consumer files
reads `unnamed` and reds the gate, with nothing in the spec explaining why.
The package's own two runners report it; a third-party runner written to the
contract cannot.

- **(a) State the skipped half in the bullet.** "report, per name, whether
  one passing test carried it, whether a skipped test names it, and which
  file carried it" — and say in *The judges* that the skipped half is what a
  `laneTests[]` line is owed on. Cost: one more sentence in the thinnest
  description of the three operations.
- **(b) State it, and say what a tool without skips gets.** As (a), plus the
  position `harness/runner.ts` already takes at the field: a runner whose
  tool cannot report skips reports `false` and its consumer has no
  `laneTests[]`. Cost: the runner row gets longer; benefit: the consumer who
  would have hit the silent red is told at authorship.
- **(c) Leave it, on the grounds that the report's shape is the package's
  type and the spec need not restate it.** Cost: the one operation whose
  report the spec *does* describe describes half of it, which reads as the
  whole.

I would take (b). (a) fixes the omission but leaves the consequence for the
consumer to discover from a red gate; the sentence that prevents that is one
clause long. (c) is defensible for a report the spec never characterized, but
this bullet already characterizes it.

**Blocking on:** nothing in the queue. Both items are prose on a human-owned
surface; no entry waits on either, and the entry filed beside this question is
independent of both.
