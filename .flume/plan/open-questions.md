# Open Questions

Decisions parked for human input. Each question is a `##` subsection with status, context, options, and recommended disposition.

Status markers:
- **PARKED** — no movement until human resolves
- **PARTIALLY ADDRESSED** — some progress; remaining ambiguity blocks closure
- **NEEDS AMENDMENT** — answer is clear; requires a spec edit to close

<!-- questions below this line -->

## Where do node's `maxBuffer` facts live?

**Status: NEEDS AMENDMENT** — the answer looks clear; closing it is a
`.claude/rules/platform-facts.md` edit no autonomous phase may make.

`SPAWN_OUTPUT_CAP_BYTES` (`tests/helpers/subprocess.ts`) states two external
toolchain facts in its doc comment and nowhere else: node caps a captured
child stream at 1 MiB unless told otherwise, and it reports the overrun by
killing the child and rejecting with `ERR_CHILD_PROCESS_STDIO_MAXBUFFER`
*where an exit status would be* — so an inherited cap surfaces through
`exitStatusOf`'s no-exit-status arm as a child that never ran, not as a
truncation. Neither is pinned by any test and neither is on the page.
CLAUDE.md rules a code comment carrying a platform fact "a copy the harness
should own instead, seen only by an agent that already opened that file", and
the page has no `maxBuffer` section today (checked this tick).

The second fact is the load-bearing one: it is why the cap exists at all, and
it is the reading a site inheriting the default would get wrong. It is also
about to be read by more than one site —
EVERY-TEST-EXEC-RUNS-UNDER-THE-DECLARED-CAP routes 22 files through the
capped wrapper.

- **Add one section to the page** stating both facts, and shrink the doc
  comment to a pointer in the same commit (`engineering.md`, *Narration is
  the ladder's bottom rung*). Recommended: the comment's sizing rationale —
  why 16 MiB, read off `src/`'s own spawn caps — is a repo decision and stays
  at the site; only the two node facts move.
- **Leave it at the site.** One home today, and the page stays shorter. The
  cost is that the next author who writes a bare `promisify(execFile)` has no
  page to have read.
