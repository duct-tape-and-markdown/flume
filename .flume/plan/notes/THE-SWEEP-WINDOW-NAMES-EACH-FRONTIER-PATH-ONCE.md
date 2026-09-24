# The frontier is a union now; the retired-claim delta is still per-line

The frontier block is two blocks: the sweep-domain paths the range touched,
each named once and sorted, under a header counting the commits; then the
posture pages that range touched, called out separately because a touched
page is a phrase delta and arms the whole domain rather than adding one path.
Commit shas and subjects are gone from the window entirely — nothing read
them.

Two things the next plan tick may want:

1. **The retired-claim delta is now the render's bulk.** At the measured
   19-26-00 render it was 63 KB against the frontier's 133 KB; with the
   frontier collapsed to ~221 lines, the delta is the only block that still
   scales with the length of the rotation. It is the one block
   `WINDOW_LINE_BUDGET` bounds (`harness/sliceWindow.ts`,
   `harness/sweepWindow.ts`), so it truncates rather than grows without
   limit — but a rotation open across hundreds of spec-touching commits
   spends its whole budget there every tick, re-rendering lines prior ticks
   already read. No cursor tracks what the delta has been read through.
   Filing that is plan's call, not this entry's.

2. **The frontier listing has no budget of its own, deliberately.** It is
   bounded by the size of the sweep domain, not by the range: a union over
   every domain path is the whole domain, which is the phrase-delta case
   already.

The window no longer tells a tick *which commit* touched a frontier path. No
consumer asked for it — `.claude/rules/posture-sweep.md`, *A violation counts
only when verified on disk this tick*, forbids a finding read off a commit
message, so the subjects were material the prompt forbade acting on.
