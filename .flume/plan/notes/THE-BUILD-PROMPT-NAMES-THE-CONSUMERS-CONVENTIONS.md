# The PROTOCOL arg now reaches build, but only build's end is pinned

Shipped: `harness/prompts/build.md` grew an `<artifacts>` block in CONTEXT
carrying `project conventions: {{PROTOCOL}}`, the line its three siblings
already hold. The value was already in `sharedPromptArgs`, so no producer
changed — the prompt was simply dropping an arg it was handed.

Two things the next plan tick may want.

**The siblings' end is unpinned.** The new case
(`tests/harnessPrompts.test.ts`) judges `build` alone, because that is the
title the entry named. Nothing in the suite asserts that `plan-inbox`,
`plan-derive`, or `plan-sweep` still name `{{PROTOCOL}}`: any of them could
drop the line tomorrow and stay green, which is the same defect this entry
fixed wearing a different phase. The shape that closes it is the one
`TURN_BOUNDARY` and `PUT_DOWN` already use in that file — one case over
`PHASES`, placeholder at the markdown end and the producer's path at the
render's. That would subsume the case shipped here, so if it is filed, it
replaces rather than joins it.

**Build names no other artifact path.** `build.md` still names none of
`PENDING_DIR`, `QUESTIONS_DIR`, `RECORD_DIRS`, or `DISCIPLINE`. Three of
those look deliberate — a build tick does not pick from the queue, does not
write questions, and the discipline page is the slices' — but `RECORD_DIRS`
is arguable: build's own note paths are spelled per-arg (`NOTE_PATH`,
`PARK_NOTE_PATH`, `CONTINUING_NOTE_PATH`) rather than off the shared
listing, which is close to the restatement bar this entry cites. Not filed;
flagging so the call is plan's.
