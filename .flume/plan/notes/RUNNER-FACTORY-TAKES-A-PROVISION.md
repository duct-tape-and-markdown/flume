# provision and the worktree hook diverge in the no-setup case

`provisioning()` (harness/chain.ts) is one reduction with two callers: the
`Phase.setupWorktree` hook and the runner factory's `provision`. They agree
wherever a consumer declared `setup`. They diverge where none is declared:
the hook stays `undefined` (the engine provisions nothing for a build
worktree), while `provision` falls back to the engine's installer at the
root — which `spec/harness.md`, *The runner interface*, states outright and
the entry's pin now covers.

So "the base is judged the way it builds" holds exactly for declared-setup
consumers. A no-setup consumer's base checkout gets an install its build
worktrees never get; without it a base run has no deps and cannot report
anything, so the fallback is load-bearing rather than incidental.

Worth a ruling only if the asymmetry is wrong — the alternative is
provisioning a build worktree the same way, which changes build behavior for
every no-setup consumer and is outside this entry. Flagged so a later sweep
reads the divergence as declared, not as drift.
