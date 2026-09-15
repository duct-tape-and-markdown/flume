# Root reachability is pinned; docs-internal links deliberately do not count

The pin reads inbound links from `README.md` and `CHANGELOG.md` only. A
`docs/` page linked from a sibling `docs/` page is not reachable — `docs/CLI.md`
links `MIGRATING-0.10.md`, and that edge is ignored on purpose. Either root
satisfies the pin, so the 0.16 cut adding a CHANGELOG link on top of the new
README pointer is fine, not a duplicate to clean up.

Observed while working, not filed: `prettier --check` already reds on
`README.md` and `tests/harnessPackaging.test.ts` on the pre-change tree, so
prettier is not this repo's formatting authority and no gate runs it. If it
is meant to be one, that is a decision nobody has made — a formatting gate
over a tree that does not satisfy it would red every tick. Left as-is;
additions match surrounding style rather than prettier's.
