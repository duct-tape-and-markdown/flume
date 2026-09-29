# `spec/harness.md` bands four sources; the inbox slice drains six. What do the other two file at?

From build note THE-SLICE-PROMPTS-NAME-THE-BAND-THEY-FILE-AT. The note's author
put both at `30` by judgement and asked for a ruling; this is that ask.

Verified this tick. *The phases* (`spec/harness.md:62`-`:72`) names four
sources and their bands: a downstream report or an operator's ruling `30`, a
build note `20`, a spec commit `10`, the sweep `0`. The inbox slice drains two
more that no band names:

- **A failing title lifted out of a red CI lane.** *CI lanes as a findings
  source* (`:218`) makes a lane a findings source "beside the inbox" and says
  the slice "files or re-files each the way it drains a record" — routing, not
  rank.
- **A record from the declared friction channel.** *Declared findings sources*
  (`:262`) reads it "as it reads the inbox" — again routing, not rank.

`FILING_BANDS["plan-inbox"]` (`harness/prompts.ts:172`) currently bands both at
`30`, reading a lane's report of a failing behavior and the loop's note to its
owner each as a downstream report. That reading is defensible and undeclared.

## The fork

1. **Ratify `30` in the spec.** Name both in *The phases*' band sentence as
   downstream reports. Cheapest, and it matches what ships. Argues that a red
   lane and a friction note are both the system reporting to its owner, which
   is what `30` already means.
2. **Give the lane its own band.** A lane title is machine-generated and
   re-reported every push, unlike a human's inbox finding; banding it at `30`
   lets a flapping lane outrank an operator's ruling indefinitely. A band
   between `20` and `30` would keep it over a build note and under a human.
3. **Rule the list illustrative, not exhaustive**, and say so — then the
   prompt's judgement is licensed rather than undeclared, and no band moves.

If (1) or (3), nothing else changes. If (2), the fix is one clause in
`FILING_BANDS["plan-inbox"]` and one clause-count in the inbox test; the note
confirms nothing else keys on it.

## Out of scope here

The note's second item — that the band is prompt prose and no gate holds a
filed entry to it — is already the queue's
`THE-ENTRIES-A-SLICE-ADDS-CARRY-ITS-OWN-BAND`, in flight as of this tick.
