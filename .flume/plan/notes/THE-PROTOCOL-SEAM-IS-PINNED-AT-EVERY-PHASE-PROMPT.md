# The PROTOCOL seam now reads like the boundary and put-down cases

The build-only case at `tests/harnessPrompts.test.ts` is gone, replaced by
one loop over `PHASES` judging both ends — `{{PROTOCOL}}` in the shipped
markdown, `protocolPath(stateRoot)` in the render. All four prompts were
already green; this was a missing pin, not a missing substitution. Dropping
the case took `BUILD_PHASE` out of the file's imports, so nothing in
`tests/harnessPrompts.test.ts` names a single phase by constant any more —
every rendering case there is now a roster loop (`PHASES` or `PLAN_SLICES`)
except the `INBOX_PHASE` ones, which are about that slice's own drain.

Observed for the declared seam (THE-THREE-PROMPTS-SHARE-ONE-RENDER-OF-EACH-SPAN):
the `project conventions: {{PROTOCOL}}` line is hand-copied verbatim into all
four `<artifacts>` blocks — `harness/prompts/build.md:24`,
`plan-inbox.md:43`, `plan-derive.md:31`, `plan-sweep.md:31`. Four copies of
one line, which is exactly the markdown end that entry moves into a shared
render. When it lands, the `names:` half of this pin reads the shared span
rather than four files, and the loop stays as written.
