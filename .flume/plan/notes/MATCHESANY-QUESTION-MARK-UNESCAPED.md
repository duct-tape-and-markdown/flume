# `?` is now a literal, which diverges from every other glob dialect

The fix is one character in `globToRegex`'s escape class, and spec/pending.md
("`*` and `**` the only wildcards") makes the literal reading correct. But
minimatch, fnmatch, gitignore and `.gitattributes` all read `?` as
single-character wildcard, so a chain author declaring `writablePaths:
["src/?.ts"]` now gets a silently narrower fence than any of those would give —
no error, just a glob that matches one odd filename. Worth a decision:

- leave it literal (current, and what the spec says), and say so in the
  `writablePaths` doc comment so the hover text names the divergence; or
- implement `?` as `[^/]` and make the matcher's wildcard set match the
  dialect readers expect.

Second finding, already mechanized here: the escape class is a hand-kept
character list, and `?` fell out of it with nothing red. The new pin drives
every ASCII punctuation character except `*` through the real `matchesAny`,
so a member dropped from the class fails whichever one it is — no list to
keep in sync. If a `?` wildcard ever lands, that pin needs its exception.
