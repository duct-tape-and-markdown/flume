# The hold verb landed on mechanism that was already there

Most of the entry's predicted surface was already shipped. `Baton.hold`,
`held()` and `isHeld()` existed; `heldDir` was already in `src/paths.ts` and
already in `STATE_ROOT_NAMES`, so the second-root collision read and the
README's derived list needed no new name; and `src/Dispatcher.ts` already
declines a held phase at both the pick and the handoff's wake filter. The one
missing mechanism was `Baton.unhold` — nothing could clear a marker. So this
tick was the CLI surface plus that removal, not the hold machinery.

Two things a later tick may want to know:

1. **The marker verbs' stdout line gained a second clause.** `wake`, `sleep`
   and `hold` are one function over `BATON_MUTATIONS` (`src/cliBaton.ts`), and
   each row's `apply` now returns an optional clause naming the *other* marker
   it moved: `held probe — awake flag cleared`, `woke probe — hold cleared`,
   and the bare `held probe` / `woke probe` where nothing else stood. Two
   markers decide one phase, so a line naming only the one the operator typed
   left the other move unreported. Anything parsing that listing reads a
   suffix it did not before — the prefix is unchanged, so a `toContain` on the
   verb word still holds, but an equality read does not.

2. **A hold marker's name is as unvalidated as a flag's.** `hold` takes the
   same best-effort chain load `wake`/`sleep` take, so a typo under a chain
   that will not load lands a marker no phase reads, and `flume status` lists
   it. That is the declared disposition for flags, inherited here deliberately
   rather than decided; if holds should be stricter than flags it is a spec
   question, not a defect of this entry.

No debt observed beyond that. The entry's `files.edit` named `src/paths.ts`
and `src/Baton.ts`; only the latter was touched.
