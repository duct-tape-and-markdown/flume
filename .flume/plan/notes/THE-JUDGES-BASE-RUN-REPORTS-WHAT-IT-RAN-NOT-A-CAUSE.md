# The suite-failed message now reports two runs and stops

`harness/judge.ts` built the `suite-failed` message with a third clause —
`so the failure arrived with this span` — concluded from one green base run.
It now ends at the evidence: `; the same N file(s) ran green at <short>`.
`blamesSpan`, the `base-red` arm and the base run itself are untouched.

Two things the next plan tick may want:

1. The case that held this arm was titled "a red suite green at the base
   names the span rather than leaving the reading open" — a title claiming
   exactly the verdict being removed, and its body only asserted
   `toContain("green at")`. It is retitled to the entry's `tests[]` line and
   now pins the whole message by equality, so a fourth clause cannot be added
   silently. Worth noting that the mislabelled-title shape
   (`.claude/rules/engineering.md`, *A green verdict is proven non-vacuous*)
   was sitting on the one sentence the entry was filed against.

2. The entry's note observed that repeating the base run would price every
   red at another suite. Nothing here does that, and nothing here makes the
   one run more decisive — the load-sensitive case is still red on the merged
   tree and green at the base whichever span was merging. If a drain acting
   on a standing `gate-revert` record needs to tell a flake from a real
   regression, that discrimination has to come from somewhere other than the
   judge's prose, and it is a chain-policy question, not an engine one.
