# A migration note's break count is prose nothing pins

Adding § 10 to `docs/MIGRATING-0.17.md` meant hand-editing three places that
agree only by discipline: the intro's "Eight breaking changes" tally, its
three-way taxonomy (API / CLI / neither), and the routing block's grep-to-§
list. Nothing reads any of them against the headings, so the next section to
land leaves a stale count and a consumer reading the intro undercounts what
is due. Both halves look checkable: `^## \d+\.` headings against the tally,
and every `§ N` reference resolving to a heading that exists — the shape
`tests/pageAnchors.test.ts` already applies to markdown link fragments.

Not filed here: whether a note's own tally is pinnable is
`.claude/rules/engineering.md`'s enumeration to settle. It admits a `docs/`
page pinned "against the interface it describes", and a self-count is against
the page instead — the human's call, not build's.

§ 10's claims were read off `src/worktrees.ts` this tick: the sweep's single
end-of-run warning over unstamped registered entries, and provisioning's
stamp refusal after the registry leg.
