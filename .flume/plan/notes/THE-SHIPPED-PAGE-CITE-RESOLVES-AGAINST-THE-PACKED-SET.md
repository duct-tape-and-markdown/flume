# The packed-set reader is narrowed to pages, and refuses one `files` spelling

Three observations from wiring the shipped-page arm onto the manifest.

**The reader collects `.md` and nothing else** (`packedPages`,
`tests/helpers/packedPages.ts`). That is enough for a citation, which only
ever asks whether the install carries the page it names, and it is also what
keeps the walk off `.flume/worktrees/` — every candidate comes from a
directory the manifest itself named. Consequence worth knowing: `dist/` is
absent in a clean worktree, so a shipped page citing a packed asset by its
emitted path (`dist/harness/prompts/<x>.md`) would red on a tree that has not
built. Nothing cites one today.

**One `files` spelling is refused rather than approximated**: an entry
anchored on no directory that carries `**` (`**/*.md`). Matching it means
walking a tree the reader was handed no boundary for. If the manifest ever
grows one, the suite reds loudly at that entry instead of reporting a shipped
page as unpacked.

**`docs/CLI.md`'s section titles are usage lines**, so the three help-page
cites now carry the brackets — `(docs/CLI.md, "flume loop [--max N]")`. The
section arm folds backticks and the wrap, so the spelling is stable, but a
docs heading rewrite now reds a `--help` literal in `src/`. That is the pin
working; it is also a coupling no one had before.

Not done, and not in scope here: `README.md` and the `docs/` pages keep their
spec cites, which is what `spec/harness.md`, *Adoption and upgrade* says they
should. Only the pages the package puts in front of a consumer's own tree or
terminal were moved.
