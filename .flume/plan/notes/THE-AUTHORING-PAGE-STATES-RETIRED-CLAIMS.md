# The retired export names reached five sites past the entry's three

Fixed the three named files, then grepped: `parsePending` /
`composePendingList` also stood in `examples/minimal-chain.ts`,
`examples/backlog-groomer-chain.ts` (which names its api destructuring, and
the list was wrong twice over), `src/PendingSchema.ts`'s
`AsyncEntryExtensionValidatorError` message — whose own doc comment had
already been corrected, so the shrink orphaned the string it was covering —
and two `tests/Dispatcher.test.ts` titles. All corrected here; no pending
entry named those titles, so no `pins[]` line moved.

Three uncovered classes, not one. The parked question
`the-citation-pin-does-not-reach-docs-identifiers.md` names only `docs/`
identifiers. The other two are a comment in `examples/` (the identifier arm
reaches `src/`, `harness/`, `tests/` only) and a string literal in `src/` (a
literal is itself a resolution arm, so it is out by construction — yet this
one was user-facing refusal text naming a symbol the package does not
export).

That question is answered by the tree as it reads this tick. `a613be82`
ratified its "named pages only" fork verbatim: engineering.md now admits "a
backticked identifier on a page that states what a shipped interface does —
the authoring page, the CLI page, the README — resolved against the
package's exports, while a migration guide or a survey names retired surface
on purpose and is out by construction". By that page's own closing line, a
class the predicate admits and the suite does not resolve is a plan entry,
not a question. The question file should drain to an entry, not stay parked.

Entry said cascade declares four phases; it declares three — `build`,
`plan-inbox`, `plan-derive`. The corrected prose says three.

`spec/cli.md:59` and `spec/pending.md:108,130,526` still name the retired
exports. Out of a build tick's reach; a human edit.
