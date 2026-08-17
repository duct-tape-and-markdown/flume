# Open Questions

Decisions parked for human input. Each question is a `##` subsection with status, context, options, and recommended disposition.

Status markers:
- **PARKED** — no movement until human resolves
- **PARTIALLY ADDRESSED** — some progress; remaining ambiguity blocks closure
- **NEEDS AMENDMENT** — answer is clear; requires a spec edit to close

<!-- questions below this line -->

## Harvested chain-preset layer

Status: PARKED

Inbox proposal (2026-08-05, human, + same-day verification addendum): consumer chains (this
repo's 480-line `.flume/chain.ts`, temper's 761-line one) converge by copy instead of
construction, so fixes and defects both propagate by hand. Proposal: a versioned, CI-tested
chain-preset package, harvested (not invented) from the verbatim intersection of the two real
chains, with an escape hatch per piece and the bare-`ChainFactory` path staying first-class.

This is architecture, not a shippable unit — new package, versioning story, two-repo
dogfooding commitment. The addendum already flagged the open constraint worth settling first:
every exported piece must be API-parameterized (take `FlumeApi`/its values as arguments, import
no engine *values*) or a walk-up-resolved second preset copy reintroduces the dual-engine split
the factory shape removed by construction (`spec/chain.md`, *The chain is a plugin, not a
consumer*). Recommend the proposal's own suggested first step — diff-and-extract the agent
stack + entry extension + park predicates as individually exported pieces, no wrapper yet, port
both dogfood chains onto them — as a scoped research spike before anything bigger. Needs your
buy-in to start.

**Answered (2026-08-05, human sign-off via interactive session):** the kill-switch first step
is approved as scoped above — diff-and-extract with API-parameterized pieces only (no engine
value imports; the addendum's constraint is binding), no `presetChain` wrapper, no packaging
decision. The packaging/home fork (subpath vs sibling package, versioning story) stays parked
pending the residual-diff verdict. **Not derivable yet**: the port-proof half needs the temper
repo, and scheduling that cross-repo work is operator-owned — plan should hold this out of
`pending.json` until the operator opens the window, deriving only the in-repo extraction when
that happens.

## `cherry-pick --abort` discards bystander uncommitted state on the primary checkout

Status: PARKED

Found while building `shared-checkout-keep-reset` (per `spec/loop.md`, *Tip verify*, "dropping
it must not take bystanders"), which converted the primary-checkout **afterMerge-gate-revert**
leg (`git.hardResetTo(repoRoot, preCherry)` → `git.resetKeepTo`, keep-semantics, refuses loudly
on a textual collision) — a distinct, still-open leg surfaced during that work: the
**cherry-pick-conflict** leg. Both `Dispatcher.runSingleton` and `Dispatcher.runFanout` call
`git.cherryPickRange(repoRoot, ...)` directly against the primary checkout, and on any failure
call `git.cherryPickAbort(repoRoot)` (bare `git cherry-pick --abort`) unconditionally.

Measured directly (not inferred): if the primary checkout carries *any* staged bystander
change — an entirely new staged file, or a staged modification to a tracked file, whether or
not the path overlaps the entry's own span — `git cherry-pick <range>` itself refuses up front
("your local changes would be overwritten by cherry-pick"), which is loud and safe on its own.
But the dispatcher's unconditional follow-up `cherry-pick --abort` then **discards that staged
content**: a newly staged file is deleted outright; a staged modification to a tracked file is
reverted to the file's last-committed content. Neither is a textual collision with the entry's
own span — the abort wipes bystander state the cherry-pick itself never touched, the same class
of harm §*Tip verify* names for the afterMerge-revert leg, on a sibling code path this entry's
fence (`src/git.ts`, `src/Dispatcher.ts` scoped to the afterMerge-revert call sites) didn't
cover.

Options:
- Extend keep-semantics to this leg too: before `cherryPickAbort`, checkpoint or refuse instead
  of aborting blind — plausibly the harder case, since a cherry-pick abort mid-sequencer-state
  has no `--keep` equivalent in git's own vocabulary; the primitive that mechanism would need
  doesn't exist off the shelf the way `reset --keep` did here.
- Scope it separately: this leg is conceptually the same defect family but a different
  mechanism (`cherryPickAbort` vs. `hardResetTo`/`resetKeepTo`) and a different trigger (a
  staged bystander change at cherry-pick time, not a textual collision at gate-revert time) —
  likely its own entry rather than a late addition to this one.

Recommend the second: file a new pending entry citing this section, scoped to
`git.cherryPickAbort`'s callers on the primary checkout, once a design for the mechanism is
decided (the first bullet is the open design question a new entry would need answered).
