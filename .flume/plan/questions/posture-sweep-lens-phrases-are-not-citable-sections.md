# posture-sweep.md invites a cite its own resolver refuses

`.claude/rules/posture-sweep.md` states its standing lenses as mid-paragraph
bolds:

    A further lens is **a negative assertion over a whole rendered artifact**: …
    A further lens is **a repo-relative path composed with `node:path`**: …

`.claude/rules/engineering.md`, *Narration is the ladder's bottom rung*
declares the arms the section-cite pin resolves: "the italicized section half
of a `` (`page.md`, *Section*) `` pair, resolved against that page's headings
and bolded bullet leads". A paragraph-lead bold is neither, so every cite
aimed at a lens phrase dangles.

Not hypothetical. A build tick wrote a cite naming the negative-assertion
lens in `tests/cli.test.ts` — exactly what the routing section of that page
asks for, "`per` citing the owning section of the posture page". It reddened
trunk after merge and collaterally reverted three later entries before a
human repointed it at the enclosing heading.

The page's own routing instruction and the page's own formatting disagree, so
the next agent that names a lens writes the same dead cite.

## Options

1. **Make the lenses bullets** (spec edit, yours). Each `A further lens is
   **X**:` paragraph becomes a `- **X** — …` bullet under *The frontier is
   decidable; the neighborhood is judged*, or under a heading of its own. The
   resolver already reads bolded bullet leads, so every lens becomes citable
   with no code change.
2. **Widen the resolver to paragraph-lead bolds.** A code change that also
   needs the `engineering.md` sentence above rewritten to declare the new arm
   — a spec edit *and* a build entry, for a laxer match.
3. **Leave it; cites name the enclosing heading.** Status quo, costs nothing
   today, and the trap fires again the next time an agent cites a lens by its
   own words. Under 3 the routing line in posture-sweep.md should say so.

I'd take 1: the lenses read as list items already, and it is the only option
that removes the trap rather than documenting it.

Filed from the build note on
`CITATION-PIN-RESOLVES-A-DOCS-PAGE-SECTION-SIGN`.
