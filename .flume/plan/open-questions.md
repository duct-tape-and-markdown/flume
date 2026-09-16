# Open Questions

Decisions parked for human input. Each question is a `##` subsection with status, context, options, and recommended disposition.

Status markers:
- **PARKED** — no movement until human resolves
- **PARTIALLY ADDRESSED** — some progress; remaining ambiguity blocks closure
- **NEEDS AMENDMENT** — answer is clear; requires a spec edit to close

<!-- questions below this line -->

## A cited home that names a `*.md` page can never resolve

**Status:** PARKED
**Section:** `.claude/rules/engineering.md`, *Narration is the ladder's bottom rung*

The citation pin's pair arm — `` `name` (`src/file.ts`) `` resolves in that
file — is live, over 91 pair-form sites. A pair is the whole parenthetical:
the open paren is all that sits between the two spans, and the path closes
it. That is what keeps the ~30 section cites,
`` (`spec/loop.md`, *Section*) ``, out of the arm.

But no declaration lives in a markdown page, so a pair whose path is a `*.md`
name can only ever red. Today nothing spells one with a tight close; two
sites sit a comma or a quote away — `src/Prompt.ts:272` (`promptArgs` with
`spec/chain.md`) and `src/tickVerdict.ts:582` (`Phase.handoff` with
`spec/loop.md`). Reformat either to a tight parenthetical and a correct
citation reds.

**Options:**

1. **A `*.md` path is never a pair-position path.** Read `` `name`
   (`spec/x.md`) `` as context: the identifier resolves repo-wide, the page
   against disk. The pair arm keeps meaning "where the declaration lives",
   which is the only reading it can act on.
2. **Keep the current refusal.** A tight-closed page pair is an authoring
   error, and the section form with its comma is the sanctioned spelling for
   citing a spec page beside a name.
3. **Make a page a legal home** — resolve the identifier against that page's
   text. Rejected on its face: that resolves a token against prose, which the
   section's own carve-out exists to refuse.

**Recommended:** (1). The arm exists to pin *where a declaration sits*; a page
holds none, so every verdict it can produce there is a false red on a cite
that was trying to be helpful. (2) is defensible but spends an authoring rule
on a distinction no reader can see — a comma.

## A `*.md` cite in `scripts/` or `bin/` is pinned by nothing

**Status:** PARKED
**Section:** `.claude/rules/engineering.md`, *Narration is the ladder's bottom rung*

The section's carve-out names "a `src/`, `harness/`, or `tests/` comment", and
the pin reads exactly those three trees. `scripts/build-changelog.mjs` cites
`.claude/rules/platform-facts.md` twice; a rename of that page leaves both
standing while the four cites in the judged trees go red. `bin/` is the same
class, and both are in the sweep domain and in that rule's frontmatter paths.

The mechanical split is not arbitrary: the identifier arm resolves through the
TypeScript program, and `scripts/*.mjs` and `bin/*.js` are outside the
tsconfig. The page-name arm resolves on disk and needs no program at all.

**Options:**

1. **Split the arms by what each needs.** A page name is judged in every tree
   the sweep domain names, because a filename resolves on disk; an identifier
   stays where the checker reaches. One sentence in the carve-out, one tree
   list per arm.
2. **Widen the whole carve-out** to `examples/` and `.flume/chain.ts` only —
   the trees already in the program — and leave `scripts/` and `bin/`
   unpinned. Cheaper, and leaves the reported cite exactly as it is.
3. **Narrow instead.** Rule that a tree the pin does not read carries no page
   cite, and rewrite the two comments in `scripts/build-changelog.mjs` to
   state the fact without naming the page.

**Recommended:** (1). The carve-out's own reason — "a filename is never a
sentence" — is a property of the token, not of the tree it sits in, and the
page-name arm is already disk-resolved. (2) leaves the reported gap open by
construction; (3) trades a resolvable pointer for an unsourced assertion,
which is the direction the ladder argues against.
