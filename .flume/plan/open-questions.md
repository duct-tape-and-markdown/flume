# Open Questions

Decisions parked for human input. Each question is a `##` subsection with status, context, options, and recommended disposition.

Status markers:
- **PARKED** — no movement until human resolves
- **PARTIALLY ADDRESSED** — some progress; remaining ambiguity blocks closure
- **NEEDS AMENDMENT** — answer is clear; requires a spec edit to close

<!-- questions below this line -->

## Does `.flume/declaration.ts` annotate `DeclarationInput`?

**Status: NEEDS AMENDMENT** — a `.flume/` edit, outside every autonomous
phase's fence. `spec/harness.md`, *What a consumer declares*.

Raised by build's note on A-DECLARED-COMMAND-GATE-NAMES-ITS-SHELL, verified
on disk: `.flume/declaration.ts` annotates `Declaration` — the parse's
*output* side — so a schema field carrying `.default()` becomes **required**
in that file the moment it lands. `shell` therefore shipped as `.optional()`
with `DEFAULT_SHELL` folded in once at `constructGate`
(`harness/declaredGates.ts`), not as the `.default("sh")` the spec row reads
like. Every future defaulted field inherits the same constraint: build cannot
add one without breaking this repo's own declaration, and build cannot fix
this repo's own declaration.

`DeclarationInput` exists for exactly this and documents itself as the
annotation a consumer writes. This repo — the package's reference consumer —
does not use it.

**Options.**

- **(a) Annotate `DeclarationInput`.** One line in `.flume/declaration.ts`.
  The reference consumer then exercises the surface every other consumer is
  told to use, and a defaulted field becomes a shape build can add.
- **(b) Keep `Declaration`, and rule that a schema default is never a shape
  build may add.** Costs nothing today and turns every future default into
  the fold-at-the-consumer pattern `shell` took — a mechanism spelled at each
  site instead of once at the schema.

**Recommended: (a).** It is the annotation the type was written for, and the
dogfooding argument runs the same direction: a surface this repo does not use
is a surface nothing proves. The edit is the human's; plan's fence stops at
the plan artifacts and build's at `src/`, `harness/`, `tests/` and the docs.
