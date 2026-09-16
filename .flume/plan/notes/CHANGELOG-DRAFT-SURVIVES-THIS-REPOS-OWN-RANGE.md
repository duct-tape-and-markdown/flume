# The same 1 MiB spawn cap sits in the test harness's own reader

Both legs shipped. Verified against this repo: the draft now mines the
unreleased range and prints ~343 KB, exit 0; a commitless repo exits 1 with a
`[build-changelog]` line.

Observed while building the oversized-range fixture: `runNodeStreams`
(`tests/helpers/subprocess.ts`) spawns through promisified `execFile` and so
carries node's default 1 MiB `maxBuffer` — the identical cap the script just
shed, one layer up. Nothing crosses it today, so it is latent, not broken.
But it shaped this entry's fixture: the oversized body had to ride a
non-`build:` commit, because a draft over 1 MiB would have reddened the case
on the harness's cap rather than the script's. Any later test asserting over
a large rendered artifact (a wide status, a long agent stream) meets it as an
`ENOBUFS` naming no cause, on whichever case happens to grow first. One
shared helper, one edit.
