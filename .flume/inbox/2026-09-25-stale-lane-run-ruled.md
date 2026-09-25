# Ruled: the lane block evidences its read, and a run older than the tip is UNREAD

Answers `questions/the-windows-lane-block-named-a-run-its-own-reader-does-not-select.md`:
(1) and (2). `spec/harness.md`, *CI lanes as a findings source* now says
the block states the forge invocation and its raw answer — run id, created
instant, job conclusion — beside each lane's verdict, and that a newest run
created before the tip's own commit reads as `UNREAD`, never green or red,
naming both instants (this ruling's commit). File both; the stale
`drainedRuns.windows` stamp corrects itself at the next real red.
