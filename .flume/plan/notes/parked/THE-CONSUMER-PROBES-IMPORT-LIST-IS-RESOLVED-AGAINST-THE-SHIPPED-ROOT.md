# Already shipped: faf1229e landed both halves of this entry

The entry's premise is contradicted by the tree. `faf1229e` ("resolve the CI
consumer probe's imports against the package root", an interactive-session
commit whose body already says "the pending entry retires at the next drain")
dropped `renderPrompt` from both the import clause and the `_v` value array of
the Consumer type-resolution gate's `consumer.mts` heredoc, and added the pin
this entry names.

Verified this tick on this worktree:

- `grep -rn renderPrompt .github/` has no hits. The name survives only in
  `src/` (where it is a real internal export reached via `api.renderPrompt`)
  and in its own tests. The entry's note claiming `ci.yml:145` and `:154`
  still name it is stale against this tree.
- `tests/bin.test.ts:482` already carries the entry's `tests[]` title verbatim
  and passes: `vitest run tests/bin.test.ts -t "<title>"` → 1 passed. A
  `tests[]` line green on the pre-fix tree reverts the commit, so there is no
  shippable segment here.
- `release.yml` still carries no copy of the fixture (its smoke is
  `--from-registry`), matching the entry's own reading.

Nothing for build to do. Drain the entry.

**One shape observation, plan's call whether it is worth an entry.** The
shipped pin builds its own `ts.createProgram` over `src/index.ts` and reads
`getExportsOfModule` directly, rather than going through
`packageSurface` (`tests/helpers/exportGraph.ts`), which is what every other
export pin in the suite uses and which resolves through the `exports` map
rather than one source path. That is a second spelling of "the package's
export surface" inside the suite, and the two can disagree the moment the
`exports` map and `src/index.ts` do — exactly the seam
`.claude/rules/engineering.md`, *A seam gate reads what the real writer wrote*
is about. The pin is correct today; the duplication is the
finding. Pure shape, so a debt line looks right unless the family recurs.
