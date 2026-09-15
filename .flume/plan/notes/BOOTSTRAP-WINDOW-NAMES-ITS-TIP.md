# Bootstrap now refuses in a repo with no commits

`bootstrap()` (harness/windows.ts) resolves the tip with `rev-parse HEAD`
before listing the corpus. In a tree with zero commits that throws, and
`bounded()` turns it into the named refusal — where the old text ("stamp
HEAD") let the first plan tick bootstrap and stamp its own first commit.

Deliberate, not an oversight: there is no tip to name, and a window that
lists a corpus while naming no sha is exactly the "stamp what you
rediscover" shape the entry retired. But it is a narrowing of the
first-tick path on a fresh `git init` state root, and nothing pins it
either way — the windows suite always commits before rendering. If a
commit-less bootstrap is a case flume wants to serve, it needs its own
decision (refuse loudly vs. render the corpus with the stamp deferred),
and then a test; I did not invent one.

Also observed: the tip resolve is a second git call on the bootstrap leg
only — the sweep/derive range legs still take theirs off the scan they
already ran, as `renderSweepWindow`'s comment claims.
