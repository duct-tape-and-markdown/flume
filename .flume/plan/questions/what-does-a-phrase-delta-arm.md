# What does a phrase delta arm?

**Section:** `.claude/rules/posture-sweep.md`, *The frontier is decidable; the
neighborhood is judged* — "A **phrase delta** — the window touched a posture
page itself — puts **every module across the sweep domain** in the frontier,
because a changed phrase has been applied to nothing yet."

The reasoning is sound. The question is its price, which nothing on the page
states and which this drain measured.

## What the open rotation has cost, verified this drain

- The declared domain (`.flume/declaration.ts`) is `src/**`, `harness/**`,
  `tests/**`, `bin/**`, `examples/**`, `scripts/**` — **205 tracked files**
  (src 51, harness 44, tests 97, bin 4, examples 6, scripts 3).
- The open rotation's frontier, read off the 19-26-00 sweep render, is **221
  unique domain paths** across 627 commits since
  `b7972ec41f41adfeaecaf947a4cafe2b9970dee1`.
- `.flume/plan/state/plan-sweep.json` records **160 covered**. `git log` from
  the stamp counts **100 commits whose subject is `plan: sweep …`** — so ~1.6
  modules per tick, with ~61 frontier paths left, or roughly **38 more
  ticks**.
- The inbox finding
  (`.flume/inbox/2026-09-24-sweep-tick-is-priced-like-a-build-tick.md`) prices
  a sweep tick at ~4 minutes and $3–4 against 43k–58k tokens for a build or
  inbox tick. At that rate this one rotation is ~7 hours of a slot and a few
  hundred dollars, with more to come.

Half of the per-tick term is already queued and needs no ruling:
`THE-SWEEP-WINDOW-NAMES-EACH-FRONTIER-PATH-ONCE` collapses the 2,603-line
commit listing to the 221-path union, cutting 133 KB from a 245 KB prompt.
That changes the price of a tick, not the number of ticks. **The rotation's
length is what this question is about.**

## The fork

1. **Leave it.** A ratified phrase governs everything, so everything is read
   against it once; the page already says so on purpose, and the sweep is
   declared last precisely so the cost lands on slack rather than on build
   (*The sweep runs beside build, never ahead of it*). The cost is the
   insurance premium, and the answer is that it is worth paying.
2. **Scope the delta to the changed section.** A phrase delta arms the domain
   the changed *section* governs rather than the whole domain — the
   citation-pin sections reach `tests/`, the export section reaches `src/`
   and `harness/`. Cuts the rotation, and costs a mapping from section to
   domain slice that nothing today derives and that goes stale silently when
   a section is rewritten.
3. **Rate-limit the rotation rather than the frontier.** The frontier stays
   whole; the rotation gets a declared ceiling on ticks or on wall clock, and
   what it did not reach rolls into the next. Keeps the reasoning intact and
   makes the premium a declared number. Costs: an uncovered remainder that
   reads as swept, which is the failure the covered set exists to prevent.

Whichever way, the page is the human's lane
(`.claude/rules/spec-plan-build.md`), so plan cannot pick.

## What does not need ruling

The inbox finding named two harness questions beside this. Both were measured
against the tree this drain and neither reproduces:

- *Whether the window renders the neighborhood's imports whole rather than
  named* — it renders no imports at all. `harness/sweepWindow.ts:129`-`:167`
  composes a commit listing and the retired-claim delta and nothing else; the
  neighborhood is the agent's own reads, which no render bounds.
- *Whether `<pending-now>` at 102 KB for thirteen entries is the ledger's
  shape or the render's* — in that same prompt `<pending-now>` is **36,545
  bytes over 23 entries**, against 37,810 bytes of ledger on disk. It is the
  ledger's own bytes rendered once, so there is nothing for the render to
  fix. The 102 KB figure did not reproduce.
