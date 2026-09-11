# Two more state-layout copies the new pin does not reach

Fixing the ownership claim turned up two neighbours with the same shape,
both outside this entry's fence:

- `docs/CHAIN-AUTHORING.md:106-107` hand-lists the runtime `.gitignore`
  entries (`awake/`, `prior-attempts/`, `rendered-prompts/`, `worktrees/`,
  `node_modules/`, `loop.pid`) for the job-seed section — a copy of
  `RUNTIME_IGNORES` (`src/job.ts`), which derives from `STATE_ROOT_NAMES`.
  The doc goes stale the moment a name is added. An agreement pin against
  `RUNTIME_IGNORES` is the same shape this entry shipped and could reuse its
  writer-side reader.
- `docs/CHAIN-AUTHORING.md:863` restates the mutable-state set in prose
  ("baton, pending, worktrees, prior-attempts").

Also observed: `src/` places `tick-verdict.json` and `tick-verdicts.jsonl`
directly under the state root, and neither appeared in README's state list
before this commit. The new pin only refuses paths the docs *claim* —
nothing fails when `src/` gains a state-root name the docs never mention.
Closing that direction needs a rule for which runtime names are
operator-facing.
