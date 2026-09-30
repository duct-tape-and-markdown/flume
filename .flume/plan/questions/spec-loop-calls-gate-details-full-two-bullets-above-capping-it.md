# `spec/loop.md` calls gate `details` "full" thirty lines above capping it

One word, one edit, and I cannot make it: `spec/**` is the human's surface.

## The disagreement

`spec/loop.md:618`, in the `gate-revert` bullet, says the block carries

> its one-line `message`, its **full** `details`, its `verdict` and
> `failingFiles` where it returned them

`spec/loop.md:656`, in the same section, says

> **Bounded by construction — a digest, not a transcript.** Gate details,
> diffstats, and agent messages are each capped at a few KB with an explicit
> truncation marker.

So the spec contradicts itself within one section, and the runtime follows
line 656: `details` is bounded to 8 KiB keeping both ends, which
`docs/CHAIN-AUTHORING.md:2107` now states and `tests/priorAttempts.test.ts`
now pins against what the real builders emit.

Until last tick nothing read line 618 against anything, so the word sat
harmless. `EVERY-BOUNDED-PRIOR-ATTEMPT-FIELDS-BULLET-STATES-ITS-BOUND`
changed that: the authoring page and the spec now make opposite claims about
the same field, and the page's half is pinned.

## What I recommend

Strike `full` from line 618 — `its `details``, or `its bounded `details`` if
the bullet should carry the fact rather than defer to *Bounded by
construction* below it. Nothing else moves: no code, no test, no page. Line
656 is already the truth and the implementation already matches it.

I am filing this rather than proposing it in a commit only because plan
cannot touch `spec/`. If you would rather the rosters on both pages carry
their own bounds, that is the second option, and it is a larger edit than
this defect needs.

Source: build note on
`EVERY-BOUNDED-PRIOR-ATTEMPT-FIELDS-BULLET-STATES-ITS-BOUND`.
