# A failed read names no path, and two more readers lean on the errno to name one

Measured this tick (node 22): `readFile` on a directory rejects with
`EISDIR: illegal operation on a directory, read` — no `path` property, and
no path in the message. The open succeeded; the read failed, and node drops
the path there. So a bare rethrow out of a per-file read is loud but
unactionable: an operator gets an errno and a store of many files. That is
why `PriorAttemptStore.read`'s refusal states the path itself.

Two things for plan:

1. **The same hole at `src/tickVerdict.ts`.** `readTickVerdict` and
   `readTickVerdicts` already draw the right split — `existsLoud`, then a
   bare `readFile` outside the parse's catch — so a verdict file that will
   not open refuses. But the refusal is the raw errno, so neither names the
   path, and `readTickVerdict` takes a `phase` rather than a path the
   operator sees at all. `writeTickVerdict` wraps its own read as
   `VerdictHistoryUnreadableError(path, cause)`, which is the shape the
   other two lack. Candidate at the mechanism (`engineering.md`, *The fix
   lands at the mechanism*): one loud file read, sibling to `src/fsProbe.ts`
   the way `src/stateRootWrite.ts` is the loud write, naming its subject and
   path — three call sites adopt it and the copy here goes. I did not widen
   this entry to that; it wants its own entry.

2. **The platform fact has no home.** `.claude/rules/platform-facts.md` has
   no section for it, and a build tick cannot add one, so the fact sits as a
   comment at `readRecord` — which CLAUDE.md says is the copy the harness
   should own. Routing it is plan's.

Scope note: `readAll` filters `e.isFile()`, so an unopenable record never
reaches `read` through the walk. The false "no prior attempt" was reachable
only through the direct per-ref read the dispatcher makes — which is the one
that feeds the quarantine count.
