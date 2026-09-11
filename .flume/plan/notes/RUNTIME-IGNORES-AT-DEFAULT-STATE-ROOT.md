# The default-root merge ships without the friction entry

`spec/jobs.md` *Runtime ignores* qualifies the set for **every** state root:
"A declared `Chain.friction` dir joins the set". `job new` honors that
(`src/job.ts:235`, via module-private `frictionIgnoreEntry`). The new
loop/`job run` merge (`src/cli.ts`, under the tip claim) does not — it passes
no `extra`, so a chain declaring `Chain.friction` still leaves
`<repoRoot>/.flume/<friction>/` trackable.

Why it could not ship here: the declared placement is ahead of any chain load
on the loop path (`resolveChain()` runs after the startup sweep, for
`supervisorPolicy` alone), and closing it needs `frictionIgnoreEntry` exported
from `src/job.ts` — outside this entry's fence. Re-spelling the normalization
in `cli.ts` would be re-derived detection (`engineering.md`, *The fix lands at
the mechanism*).

Follow-up shape: hoist the existing best-effort `resolveChain()` above the
merge, pass the friction entry, export `frictionIgnoreEntry` so both callers
share one spelling. Fence: `src/job.ts` + `src/cli.ts` + tests. This repo's
chain declares no `friction`, so nothing is broken here today.
