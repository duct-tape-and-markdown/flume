# Ruled: a `tests/` comment citation is a reference the scan resolves, and the page loads there

Closes the open question *A `tests/` comment may cite a rule page, and
nothing loads it or resolves it*. Option 1, widen both.

`.claude/rules/engineering.md` *Narration is the ladder's bottom rung* now
names `tests/` beside `src/` and `harness/` in the reference carve-out: a
backticked identifier, a repo-relative path, or a `*.md` page name in a
`tests/` comment is the same token pointing at the same heading, resolved
against the declarations and the working tree — the token, never its meaning.
The shipped/unshipped distinction bears on prose read for what it says, and
this carve-out reads none. `platform-facts.md`'s frontmatter now loads the
page under `harness/**` and `tests/**` as well, so an agent editing a test
helper sees the fact its comment points at.

What derive files: the comment-citation scan's tree list gains `tests/`; the
nine standing `tests/` citations are its first judged set.

The question closes; the rule page holds the ruling.
