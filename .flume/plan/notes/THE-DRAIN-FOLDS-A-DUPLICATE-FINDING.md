# The fold is now said three times in one prompt

Shipped as written: the pending-entry bullet in `harness/prompts/plan-inbox.md`
now says a standing entry that covers a finding is amended, not siblinged, and
names the `clean-exit` record a duplicate that reached build leaves.

What plan should weigh: that sentence is the third copy in one file. The
question bullet says it ("one that covers this finding takes an amendment to
that file, not a sibling beside it"), the CI-lane paragraph says it ("a title
already heading a queue entry or an open question is amended, never re-filed as
a sibling"), and the pending bullet now says it too. Each is scoped to its own
keying — the questions index, lane+title, `<pending-now>` — so none is
redundant as written, but the shape is one directive stated per route rather
than once over the list. If a fourth route ever wants it, the fix is a single
sentence above the three bullets naming the fold once and letting each bullet
name only its key, rather than a fourth copy. Filing that now would be a
rewrite with no behavior behind it, so it is left as an observation.

Prose was the only rung available, as the entry said: the fold is a judgement
the drain makes over `<pending-now>`, and nothing mechanical can hold it —
there is no duplicate gate to add, by `spec/harness.md`'s own ruling. Entry
carried no `tests[]` or `pins[]`; `pnpm tsc --noEmit` and the full vitest lane
are green (1719 passed, 22 skipped), and the prompt suite's taxonomy pin still
holds since `clean-exit` was already named in this file.
