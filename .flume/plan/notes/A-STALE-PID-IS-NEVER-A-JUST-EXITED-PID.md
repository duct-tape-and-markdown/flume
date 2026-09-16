# The pid-recycling fact has no mechanical home

The defect the entry names is a platform fact: a reaped pid returns to the
host's allocation pool, so a pid harvested from a just-exited child can name a
stranger by the time the reclaim under test reads it — win32 recycles soonest,
which is why only that lane red. `.claude/rules/platform-facts.md` is the
declared home for exactly this kind of fact and carries no pid entry today; a
build tick cannot write there, so the fact now lives as prose in
`tests/helpers/deadPid.ts`'s header — the copy CLAUDE.md says the harness
should own instead. Worth a human edit to platform-facts.md, with the helper's
header shrinking to a pointer.

Also: the harvest is the obvious thing to reach for, and eight sites across
three files reached for it independently before anything caught it. The helper
is the one door now, but nothing mechanical stops a ninth site from
re-inventing it — a scan over `tests/` for a pid read off a settled child
would.
