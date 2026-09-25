# The drain's count is unbounded; the sweep's is still per-rotation

Shipped: `harness/prompts/plan-inbox.md:62` now counts the three-notes bar
over every plan commit body, whichever slice wrote it, with no window, and
says why it ends itself. No property claimed — this prose ships to
consumers and `engineering.md`, *Narration is the ladder's bottom rung*
keeps harness prose out of the suite.

Observed while scoping: the two bars now read differently. The drain's is
unbounded (`spec/harness.md`, *The phases*, ruled c684223f). The sweep's
lives in `.claude/rules/posture-sweep.md`, *Routing* — "accepted as debt in
three plan commit bodies **of one rotation**" — and `harness/prompts/plan-sweep.md:42`
 routes findings by deferring to that page rather than
spelling a count, so the sweep slice still counts inside a window. Spec says
"The drain files by the sweep's bar", then overrides the window for the
drain alone, so the divergence is at least stated; whether the sweep's own
window survives the same self-termination argument is a human call, not
mine. Both pages are the spec locus — a build tick cannot touch either.

No other site in `harness/`, `src/`, `tests/` or `docs/` spells the bar:
grep for "noted three times" and for the old window phrase returns only the
line changed here.

Seam note: this file is also the target of
THE-QUEUE-LISTING-MARKS-THE-ENTRIES-IN-FLIGHT. My edit is confined to line
62 and touches no other paragraph, so the two should cherry-pick cleanly
unless that entry rewrites the same line.
