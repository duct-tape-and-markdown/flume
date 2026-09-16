# Ruled: `loop.pid` states the claim instant; the pid stays on the first line

Closes *Does the supervisor state when a run started, or does `flume status`
keep measuring it?* (open-questions, 35413267). Option (b). `spec/loop.md`
*The loop lock and the tip claim*: the lock carries the pid on its first
line and the instant it was taken on the second; the tip claim takes the
same shape. `spec/cli.md` item 7 reads the run's start from that statement.
The measurement off mtime was correct today and contracted by nothing.

The ordering hazard the question measured is the ruling's shape: the pid
stays the first line, where every earlier reader looked, so a same-version
reader is unaffected. A 0.16 CLI reading a 0.17 lock parses the whole file
to `NaN` and reclaims a live lock — mixed versions on one state root — so
the entry is contract-touching, lands under 0.17's `### Breaking`, and the
migration note names it. What derives: the writer, both readers, the test
that a two-line file still reports live on the first line.
