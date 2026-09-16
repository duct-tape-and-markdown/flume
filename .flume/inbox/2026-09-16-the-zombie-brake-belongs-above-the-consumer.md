# Every consumer will reinvent "don't re-dispatch against an unchanged world" (pilot report from a win32 consumer on node 22, relayed by the operator)

A ~20-line `shouldRun` refuses an entry whose last dispatch exited clean
without committing while nothing has landed since — written after one entry
burned four bails against an unchanged tree. It reads the record's `mode`
through a local cast (the P4 hole) and compares mtimes, though the record
has carried `headSha`/`at` since 0.13. The engine holds every fact; the
consumer holds the heuristic.

Fork, on `engine-boundary.md`: (a) the harness package's default pickability
refuses an entry whose latest prior attempt is `clean-exit` at the current
HEAD — every declared consumer gets it, hand-written chains copy one line;
(b) engine pickability, as mechanism — a stateless tick over identical input
is the identical outcome, which is not a policy anyone would choose
otherwise. Recommended (a) unless the engine already has a per-entry
pickability surface a chain cannot reach.
