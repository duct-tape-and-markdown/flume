# Repo-file citations resolve only by accident

Measured as predicted: judged 1124 -> 1316, dangling 7 distinct / 11 sites,
no prose pulled in. Two exclusion lists now, because the judgment call had a
rung available: `EXTERNAL_VOCABULARY` (cmd.exe, exactOptionalPropertyTypes,
fs.rm, scripts.lint, sysexits.h) carries a per-entry reason, while
`REPO_FILE_VOCABULARY` (engineering.md, tsconfig.build.json) carries the
repo-relative path instead, and the pin asserts that path exists on disk —
so a renamed rules page reds rather than sitting excluded.

Debt observed: that check is the only coverage repo-file citations have, and
it is accidental. src/ cites that same page 150 times as the full
`.claude/rules/engineering.md` — slashes fail SEGMENT, so those spans are
never judged. Only the four bare-basename sites dangled into the list.
Rename the page and 150 citations go stale silently while 4 red. The fix is a
resolution arm, not an exclusion: a backticked span shaped like a
repo-relative path resolves against the working tree. Worth an entry.

Minor: the repo pin's vacuity floor is still `> 500` against 1316 judged.
