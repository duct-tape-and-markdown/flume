# The -z decode is package-internal, and `ls-files` had the same defect

Two things the next derive tick may want.

**`nameOnlyPaths` is exported from `src/git.ts` but not from `src/index.ts`.**
`harness/windows.ts` reaches it by relative import, which only works because
the harness package ships beside the engine in this repo. A downstream chain
writing its own window reader — the exact shape `harness/` is the reference
for — cannot reach the decode and will re-derive it, which is
`engineering.md`, *A fact the engine holds is reported*. Filing it as public
API is a boundary call (is a decode helper engine surface, or chain-side
convenience?), so it is here rather than in the queue.

**`bootstrap`'s `ls-files` carried the same line-split defect** and is fixed
in the same commit, one line past the entry's prediction. Same file, same
decode; a control-character path would have dropped out of the first tick's
whole-corpus listing too.

`-c core.quotePath=false` stays on the shared `git()` wrapper, now cited at
the site as buying only the rendered patch text's non-ASCII headers — it is
no longer load-bearing for any listing.
