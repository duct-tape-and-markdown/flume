# The anchor arm's domain stops at the prose its authors hold

The arm judges links out of docs/, examples/, harness/, README.md,
CHANGELOG.md and .flume/PROTOCOL.md. spec/ and .claude/ are out on the
ladder's carve-out (prose held by its authors), so a dead anchor authored
inside a spec page is unjudged; those pages still *answer* fragments aimed
at them from judged pages. If you want spec/ links judged too, that is a
spec decision, not a build one.

The domain is a declaration, so a new tree of pages could silently go
unread. A second case pins it: the sweep domain's trees are walked for .md
and every page found must be in the judged set, so a page added under
tests/ or src/ reds rather than being skipped.

Observed while fixing docs/MIGRATING-0.10.md:185 — the prose around that
link still reads "A job is now exactly `.flume/jobs/<name>/`", but the job
apparatus is gone from src/ entirely. Historical migration notes are not
swept, so nothing will catch that; left as written.
