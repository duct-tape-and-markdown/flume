# Does `spec/jobs.md` keep rostering the runtime ignore set, or point at the set that holds it?

`spec/jobs.md`, *Runtime ignores* carries a fenced listing of `RUNTIME_IGNORES`.
Measured against `.flume/.gitignore` on this tree (which `ensureRuntimeIgnores`
wrote), the page's listing is four lines behind what the runtime owns:
`invocations/`, `run-end.json`, `held/` and `tick-verdict.json` are shipped and
unlisted, and the page lists `tick-verdict/` beside them.

Nothing reds over it: `tests/harnessIgnores.test.ts` pins every
`STATE_ROOT_NAMES` value into the derived consumer set and the repo's own
`.gitignore`, so the mechanical side moves with each new artifact and the prose
side moves only when someone remembers. That is the shape
`.claude/rules/engineering.md`, *Derived state is computed, never restated beside
its source* names, in prose — and the same shape two recent spec commits already
chose against (`810bd378` pointed at the entry schema instead of rostering it;
`a96a18ca` stopped rostering `TickResult`'s facts).

- **(a) Point at it.** The section states what the set is *for* and that
  `RUNTIME_IGNORES` is its one home, with the names read off the export. The
  listing stops being a thing that can lag. Costs a reader one hop to see the
  names, and `spec/jobs.md` exists largely to carry this set (CLAUDE.md: it
  "holds the runtime ignore set until its citations move"), so the page shrinks to
  the merge semantics and the ownership rule. My lean.
- **(b) Re-roster and pin it.** Add the four lines and have the ignores case assert
  the page's fence against the set, so the next addition reds the page. Keeps the
  names where a reader already looks; adds a spec page to the suite's prose
  surface, which `engineering.md`'s carve-out admits only for `docs/` and the
  README, not for `spec/`.
- **(c) Re-roster and leave it unpinned.** Cheapest now, same lag next time.

Human's either way — `spec/` is not a lane plan or build writes.
