# The path arm shipped; one hand-held name is left, and it is repairable

Judged set 1316 -> 1788 sites (472 path citations). Floor left at `> 500`
per the entry's rider.

Two residues the entry did not predict fell out for free: `.git/config` and
`refs/heads/main` are refused by the named-extension rule (a git ref is not
a working-tree path), so no `.git` special case was needed.

Excluded with reasons, as the entry directed: `dist/harness/init.js`,
`dist/harness/prompts.js`, `dist/src/cli.js`, `plan/pending.json`,
`.flume/loop.pid` — 5 names, 11 sites, in `EXTERNAL_VOCABULARY`.

**Repairable residue for a later entry.** `REPO_FILE_VOCABULARY` is down to
one entry, `engineering.md`, and the arm cannot reach it because the 4
comments citing it drop the directory: src/git.ts:446, src/Dispatcher.ts:132,
:148, :711. Writing those four as `.claude/rules/engineering.md` (the
spelling the other 150 sites already use) empties the list and deletes the
hand-maintained name-to-path map altogether — the last place the verdict is
overridden by hand for a file that is right here.
