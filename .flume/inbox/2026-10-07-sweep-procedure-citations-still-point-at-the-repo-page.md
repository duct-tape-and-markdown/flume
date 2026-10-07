# Citations of the sweep procedure still point at this repo's rule page

The sweep procedure now ships in the package (`spec/harness.md`, *The sweep
procedure*; `harness/prompts/plan-sweep.md` carries it, confirmed
2026-10-07). `.claude/rules/posture-sweep.md` still holds the same procedure
text, so it has two homes until that page is trimmed to this repo's
*Standing lenses* (its header names that trim).

The trim cannot land first: comments in `src/` and `tests/` cite the page's
procedure sections, and the citation pin resolves each against the page's
headings, so cutting them reds the default lane. Sites found by
`grep -rn -A1 "posture-sweep.md"`, citing *The stamp*, *The frontier is
decidable; the neighborhood is judged*, *The pages are the authority as they
read this tick*, and *The sweep runs beside build, never ahead of it* — e.g.
`tests/harnessGates.test.ts:1732`, `:1765`; `tests/harnessWindows.test.ts:466`,
`:2176`; `tests/commentCitations.test.ts:587`. Citations of *Standing
lenses* and its bullet leads stay: that section stays on the page.

Fix: re-cite every procedure-section citation to `spec/harness.md`, *The
sweep procedure* (its bold bullet leads — *The frontier is read off git.*,
*Routing.* — resolve like headings), in one commit. Then an interactive
session trims the page and re-cites `engineering.md`'s one *Routing* cite
(line ~263); that rule-page edit arms a full-domain sweep rotation, so the
operator times it.
