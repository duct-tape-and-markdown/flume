# One access class, and a sweep the constructor's mkdir was propping up

**Fork taken: one access class.** `src/stateRootWrite.ts` is now
`src/stateRootAccess.ts`; `StateRootAccessError` carries the direction
(`read` / `written`), so the write sentence is unchanged and the read one is
its sibling in the same class, at `main`'s one arm. A *second* class was
measured and rejected: with two documented causes, the denial fixture can
drive `tick` and `loop` only to their reads (both read the baton before they
write), so their pages would have had to drop the write cause — the weakened
equality the entry forbids. One cause, one scope, no weakening.

That moved the help phrase: "stats as a directory and admits no write" →
"stats as a directory and the state under it will not open", restated in the
six `docs/CLI.md` sections whose verbs take it. `render` takes none of it now
and its row is the read-only clause; its no-write claim is pinned in
`tests/cliRender.test.ts` off the real bay listing.

**A latent defect the narrowing exposed.** `sweepStaleWorktrees`
(`src/worktrees.ts`) proved its base absent-or-directory by descending from
`ctx.flumeDir` — which is above the *default* base and above nothing else. A
chain-declared base outside the state root therefore read as absent whenever
the state root did not exist yet, and the sweep removed nothing: every
abandoned worktree and its branch left standing. Green only because the
`Baton` constructor's `mkdir` had made the state root for it. Now keyed on
`escapesRoot`.

**Debt for the queue.** `isDirectoryOrAbsentUnder` (`src/fsProbe.ts`) takes a
`root` its doc says is an ancestor of `path` and holds nothing to that: handed
a root that is not, it answers `false` — a silent wrong absence, the class
`Loud or nothing` exists for. The sweep was its only such caller; a refusal
at the helper would have caught it, and would catch the next one. Candidate
entry `per` `.claude/rules/engineering.md`, *Loud or nothing*.
