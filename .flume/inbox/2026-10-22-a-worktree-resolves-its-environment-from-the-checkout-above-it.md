# A worktree resolves its environment from the checkout above it, and reads as provisioned (downstream consumer report, class)

**Kind.** The default worktree base is inside the primary checkout
(`<flumeDir>/worktrees`, `spec/worktrees.md`), so every resolver that walks
upward — node's `node_modules`, the nearest `package.json` `type`, prettier /
eslint / tsconfig / `.npmrc` lookups — silently answers from the primary
checkout when the worktree lacks its own. An unprovisioned worktree
therefore works, at the parent's versions and config, until a consumer step
that does not walk up skips silently. `engineering.md`, *Loud or nothing*.

**Members.**
- Field instance: no `setup` declared → build worktrees had no
  `node_modules`; tools resolved the parent's; a repo hook keyed on
  `$ROOT/node_modules/.bin/…` skipped silently, so a format-on-edit hook
  never ran and gates reverted the unformatted builds (one a $5 build).
- Provisioning decides one question two ways: with `setup` undeclared,
  `provisioning` (`harness/provisioning.ts`) installs the runner's base
  checkout, while `worktreeSetup` returns no hook for build worktrees. Same
  consumer, same lockfile, two answers.
- The defence is prose only: `platform-facts.md`, *pnpm deletes a symlinked
  `node_modules`*, prescribes "a sentinel gate that fails loud when a
  dependency stops resolving from the worktree root". Nothing ships it —
  the ladder's bottom rung holding a check a gate can express
  (`engineering.md`, *Narration is the ladder's bottom rung*).

**Owning artifact.** The harness's provisioning (its opinion, not `src/`):
one answer to "how is a tree this consumer judges or builds in provisioned",
read by both callers, plus the sentinel promoted from the platform-facts
prose to a shipped check — which then shrinks to a pointer.

**Decision for the human.** Which loud form: (a) build worktrees get the same
installer the base checkout already gets when `setup` is undeclared; (b) a
provisioned-ness check that refuses a worktree whose dependencies resolve
from outside it; (c) both. Whether `flume check` should also say it is a
consumer's to ask for, not a substitute for (a)/(b) — a warning at check
time is the narrated rung.
