# The queue listing span is now copied three ways

Shipped: `planSlicePromptArgs` hands the claimed set out twice — the
`<in-flight>` block it already composed, and `CLAIMED_TAGS`, the bare tags the
listing's own span tests each file name against. A claimed entry's header line
reads `=== TAG.json [in flight]`.

Observed while doing it: the `<pending-now>` span is one shell line spelled
identically in `harness/prompts/plan-inbox.md`, `plan-derive.md` and
`plan-sweep.md`, and this entry grew it from four clauses to eight. It is the
`engineering.md`, *A module is one job* "second copy of a sequence" family in
prose rather than in code — the prompts have no include mechanism, so the only
homes for it are a `promptArgs` value that renders the whole listing in TS (no
span at all, which is how `QUESTIONS_INDEX` already works) or a shipped script
the three spans call. Both are real changes to what a prompt file is allowed
to carry, so I did not take either inside this entry. Debt line or entry is
yours; if it files, the target shape wants naming, since the two options
differ in whether the listing stays an inline-exec span.

Not a blocker, and nothing about the mark depends on it — but the next change
to that listing pays the 3x again, and the three copies can now drift in a way
that changes what one slice sees and another does not.

One fact the shell relies on: no tag can carry a space, a quote, or an
expansion character (`TAG_PATTERN`, `src/PendingSchema.ts`, admits
`[A-Za-z0-9._()-]`), so the tags reach the span unescaped. A grammar that
widened would move the renderer with it; that is cited at
`claimedTagWords` rather than left implicit.
