# Two citation classes the pin cannot see: the anchor, and the moved home

`.claude/rules/engineering.md`, *Narration is the ladder's bottom rung*, gives
citations their rung deliberately narrow: a pin resolves "the token, never its
meaning". Two classes fall through it, each with a live instance this drain
turned up, and both asks are rule-page edits.

**1. A section anchor resolves nowhere.** `docs/MIGRATING-0.10.md:185` links
`[spec/jobs.md § A job is a state root](../spec/jobs.md#a-job-is-a-state-root)`;
that heading went with the jobs cut, and the page name still resolves, so the
pin stays green over a dead link. Two build notes reached the same sentence
independently ("section-heading cites sit on no rung"). An anchor is a token,
not a sentence — a markdown link's `#fragment` against the target page's own
headings is as decidable as the page name already is, which reads like the
same arm one resolution finer. The `per` gate already holds plan entries to
exactly this; comments and `docs/` have nothing.

**2. A cite naming a file that no longer owns the job.** The `shell` hover in
`harness/declaration.ts` pointed at `declaredGates.ts` after the probe moved
to `declaredShell.ts` — the token resolved, the file existed, the reader was
sent to the wrong door, and only a reader caught it (fixed at fbb746c8).
*A module is one job* already requires the split to re-home its citations;
what is missing is the lens that looks, since the pin by construction cannot.

The forks, and they are yours because both edits land on rule pages:

- On (1): add the anchor arm to the citation pin's resolution — decidable,
  and it reds once today (the link above) — or declare anchors out of scope in
  the section, so nobody files this a third time.
- On (2): a standing sweep lens in `.claude/rules/posture-sweep.md` — "a cite
  whose named file no longer holds the fact it is cited for" — read on the
  neighborhood the sweep already opens, or leave it to readers and say so.

(1)-add and (2)-lens are the recommendation; (1) is the cheaper of the two and
carries its own repro.
