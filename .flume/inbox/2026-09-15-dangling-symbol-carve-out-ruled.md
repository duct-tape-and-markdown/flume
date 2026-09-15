# Ruled: a backticked identifier in code prose is a reference, and a pin may resolve it

Closes the open question *A deleted symbol leaves its doc-comment citations
standing, and the ladder's carve-out excludes the prose that broke*. Fork
option 1, held to the token.

`.claude/rules/engineering.md` *Narration is the ladder's bottom rung* now
admits two carve-outs, both reading prose against the program rather than
against prose: the `.d.ts` hover text it already named, read for what it
says; and a backticked identifier in a `src/` or `harness/` comment, which
is a reference and may be resolved against the declarations those trees
hold — the token, never its meaning. Prose read for what it says stays with
its authors, as before.

Why the token and not the comment: the bullet's failure mode is a suite that
reads prose against prose, and every section of the page becoming a
generator against it. Resolving an identifier is the footing the existing
`abortThreshold` doc-block pin already stands on. The known leak the question
names — an author drops the backticks — is accepted: the pin's job is
catching deletions, not policing authors.

What derive files: the one-file pin the question sized (1080 subjects, 0
misses at `1226c5a`), with the scanner's own flagging case as its `tests[]`
line and the tree property as a `pins[]` line, since no historical tree reds
on it. Option 3 (a sweep delta) is not taken: the check is decidable, and a
mechanical verdict belongs on the pin rung.

The question closes; the rule page holds the ruling.
